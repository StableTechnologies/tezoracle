import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifySignature } from "@taquito/utils";

import { loadCommittedRegister } from "../../src/config/policy.js";
import { createCoordinatorHandlers } from "../../src/deploy/coordinator.js";
import { assertCoordinatorRuntime, assertRelayerRuntime } from "../../src/deploy/env.js";
import { unwrapEvent } from "../../src/deploy/event.js";
import { createRelayerHandlers } from "../../src/deploy/relayer.js";
import {
  assertPinnedFileDigest,
  createSecretsManagerSecretProvider,
  createSignerHandlers,
  resolveSignerSecret,
} from "../../src/deploy/signer.js";
import { createTickHandler } from "../../src/deploy/tick.js";
import { packConfigIntent } from "../../src/packing/governance.js";
import {
  buildPinnedInit,
  type GovernanceSidecar,
} from "../../src/validator/governance.js";
import { tickHarness, localSign } from "../e2e/helpers.js";
import { CoordinatorError } from "../../src/coordinator/errors.js";
import { RelayerError } from "../../src/relayer/errors.js";
import { createMockRpc } from "../../src/relayer/rpc.js";
import {
  CHAIN_ID,
  CONFIG_DIR,
  NOW,
  ORACLE_ADDRESS,
  TRANSPORT_SIGNERS,
  coreMockTransport,
  signerSet1of1,
} from "../transport/helpers.js";

const signer = TRANSPORT_SIGNERS[0];
if (!signer) throw new Error("missing transport signer");

function withEnv(vars: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(run()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const domain = {
  TEZOS_CHAIN_ID: CHAIN_ID,
  ORACLE_ADDRESS,
  TEZOS_NETWORK: "shadownet",
  TEZOS_RPC_URL: "",
};

test("unwrapEvent accepts direct invoke and API Gateway body", () => {
  assert.deepEqual(unwrapEvent({ group: "CORE" }), { group: "CORE" });
  assert.deepEqual(unwrapEvent({ body: JSON.stringify({ group: "CORE" }) }), { group: "CORE" });
  assert.deepEqual(unwrapEvent(null), {});
});

test("coordinator and relayer refuse a signer secret in process env", () => {
  return withEnv({ TEZORACLE_SIGNER_SECRET_KEY: signer.secret_key }, () => {
    assert.throws(() => assertCoordinatorRuntime(), CoordinatorError);
    assert.throws(() => assertRelayerRuntime(), RelayerError);
  });
});

test("only the signer process resolves TEZORACLE_SIGNER_SECRET_KEY", async () => {
  await withEnv({ TEZORACLE_SIGNER_SECRET_KEY: signer.secret_key }, async () => {
    assert.equal(await resolveSignerSecret(), signer.secret_key);
  });
  const provider = createSecretsManagerSecretProvider(
    "tezoracle/testnet/class-a-signer",
    {
      async send(command) {
        assert.equal(command.input.SecretId, "tezoracle/testnet/class-a-signer");
        return { SecretString: signer.secret_key };
      },
    },
  );
  assert.equal(await provider(), signer.secret_key);
});

test("governance Lambda signs only its signer-local artifact and sidecar", async () => {
  const { snapshot } = loadCommittedRegister(CONFIG_DIR);
  const sidecar: GovernanceSidecar = {
    schema_version: 1,
    admin: "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC",
    guardian: "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC",
    threshold_n: "1",
    threshold_m: "1",
    signers: {
      "0": { public_key: signer.public_key, class_id: "A", active: true },
    },
    class_minima: {},
  };
  const intent = {
    domain: "TEZORACLE_CONFIG_V1" as const,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
    current_config_version: String(snapshot.register.config_version - 1),
    governance_nonce: "0",
    valid_until: String(NOW + 600),
    init: buildPinnedInit(snapshot, sidecar),
  };
  const packed = packConfigIntent(intent);
  const handler = createSignerHandlers({
    configDir: CONFIG_DIR,
    now: () => NOW,
    secretProvider: async () => signer.secret_key,
    governanceArtifactProvider: async () => ({
      intent,
      packed_hex: packed.packedHex,
    }),
    governanceSidecarProvider: async () => sidecar,
    governanceChainId: CHAIN_ID,
    governanceOracleAddress: ORACLE_ADDRESS,
  });
  const signed = await handler.signGovernance({ action: "config", index: "0" });
  assert.equal(signed.ok, true);
  assert.equal(signed.packed_hex, packed.packedHex);
  assert.equal(
    verifySignature(
      String(signed.packed_hex),
      String(signed.public_key),
      String(signed.signature),
    ),
    true,
  );

  for (const field of [
    "intent",
    "init",
    "packed_hex",
    "sidecar",
    "config",
    "policy_hash",
    "signers",
    "payload",
    "arbitrary",
  ]) {
    const injected = await handler.signGovernance({
      action: "config",
      [field]: field === "intent" ? intent : "injected",
    });
    assert.equal(injected.ok, false, field);
    assert.equal(injected.error_code, "POLICY_PIN", field);
  }
  const badIndex = await handler.signGovernance({ action: "config", index: 0 });
  assert.equal(badIndex.ok, false);
  assert.equal(badIndex.error_code, "POLICY_PIN");
});

test("governance deployment files are bound to SHA-256 pins", () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-governance-pin-"));
  const path = join(dir, "intent.json");
  const bytes = '{"intent":"approved"}\n';
  writeFileSync(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.doesNotThrow(() => assertPinnedFileDigest(path, digest, "intent"));
  assert.throws(
    () => assertPinnedFileDigest(path, "0".repeat(64), "intent"),
    /differs from deployment pin/,
  );
  assert.throws(() => assertPinnedFileDigest(path, undefined, "intent"), /pin is required/);
});

test("thin handlers compose trigger, candidate, 1-of-1 sign, collect, assemble, verify, submit", async () => {
  await withEnv({ ...domain, TEZORACLE_SIGNER_SECRET_KEY: undefined }, async () => {
    const coordinator = createCoordinatorHandlers({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
    });
    const relayer = createRelayerHandlers({ rpc: createMockRpc({ op_hash: "opDeployTest0001" }) });
    const classA = createSignerHandlers({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
      secretProvider: async () => signer.secret_key,
    });

    const triggered = await coordinator.trigger({ group: "CORE", round: "11" });
    assert.equal(triggered.ok, true);
    assert.equal((triggered.request as { round: string }).round, "11");

    const assembled = await coordinator.candidate({
      group: "CORE",
      round: "11",
      signers: signerSet1of1(),
    });
    assert.equal(assembled.ok, true);
    assert.ok(assembled.state);
    assert.equal(assembled.packed_hex, (assembled.state as { packed_hex: string }).packed_hex);

    const signed = await classA.sign({
      candidate: { payload: assembled.payload, evidence: assembled.evidence },
      index: "0",
    });
    assert.equal(signed.ok, true);
    assert.equal(signed.index, "0");
    assert.equal(signed.packed_hex, assembled.packed_hex);

    const collected = await coordinator.collect({
      state: assembled.state,
      signature: {
        index: signed.index,
        public_key: signed.public_key,
        signature: signed.signature,
        packed_hex: signed.packed_hex,
      },
    });
    assert.equal(collected.ok, true);
    assert.equal(collected.status, "quorum");

    const sealed = await coordinator.assemble({ state: collected.state });
    assert.equal(sealed.ok, true);
    assert.ok(sealed.batch);

    const verified = await relayer.verify({ batch: sealed.batch, signers: signerSet1of1() });
    assert.equal(verified.ok, true);
    assert.equal(verified.packed_hex, assembled.packed_hex);

    const submitted = await relayer.submit({ batch: sealed.batch, signers: signerSet1of1() });
    assert.equal(submitted.ok, true);
    assert.equal(submitted.op_hash, "opDeployTest0001");
  });
});

test("coordinator candidate fails closed without domain env", async () => {
  await withEnv(
    { TEZOS_CHAIN_ID: undefined, ORACLE_ADDRESS: undefined, TEZORACLE_SIGNER_SECRET_KEY: undefined },
    async () => {
      const coordinator = createCoordinatorHandlers({
        configDir: CONFIG_DIR,
        transport: coreMockTransport(),
        now: () => NOW,
      });
      const result = await coordinator.trigger({ group: "CORE" });
      assert.equal(result.ok, false);
      assert.equal(result.error_code, "INTERNAL");
    },
  );
});

test("relayer submit without an injected RPC is not a live endpoint", async () => {
  await withEnv({ ...domain, TEZORACLE_SIGNER_SECRET_KEY: undefined }, async () => {
    const coordinator = createCoordinatorHandlers({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
    });
    const classA = createSignerHandlers({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
      secretProvider: async () => signer.secret_key,
    });
    const assembled = await coordinator.candidate({ group: "CORE", round: "12", signers: signerSet1of1() });
    const signed = await classA.sign({
      candidate: { payload: assembled.payload, evidence: assembled.evidence },
      index: "0",
    });
    const collected = await coordinator.collect({
      state: assembled.state,
      signature: {
        index: signed.index,
        public_key: signed.public_key,
        signature: signed.signature,
        packed_hex: signed.packed_hex,
      },
    });
    const sealed = await coordinator.assemble({ state: collected.state });
    const relayer = createRelayerHandlers();
    const submitted = await relayer.submit({ batch: sealed.batch, signers: signerSet1of1() });
    assert.equal(submitted.ok, false);
    assert.equal(submitted.error_code, "INTERNAL");
  });
});

test("coordinator tick handler composes the shared tick without holding keys", async () => {
  await withEnv({ ...domain, TEZORACLE_SIGNER_SECRET_KEY: undefined }, async () => {
    const harness = tickHarness();
    const handler = createTickHandler({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
      rpc: harness,
      oracle: harness,
      sign: localSign(),
      signerSet: signerSet1of1(),
    });
    const result = await handler.tick({ group: "CORE" });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.round, "1");
  });
});

test("coordinator tick handler refuses a missing signer set and a live RPC default", async () => {
  await withEnv({ ...domain, TEZORACLE_SIGNER_SECRET_KEY: undefined }, async () => {
    const missing = createTickHandler({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
    });
    const result = await missing.tick({ group: "CORE" });
    assert.equal(result.ok, false);
    assert.equal(result.error_code, "INTERNAL");
  });
});

test("coordinator handler refuses secret-shaped collect input", async () => {
  await withEnv({ ...domain, TEZORACLE_SIGNER_SECRET_KEY: undefined }, async () => {
    const coordinator = createCoordinatorHandlers({
      configDir: CONFIG_DIR,
      transport: coreMockTransport(),
      now: () => NOW,
    });
    const result = await coordinator.collect({
      state: { secret_key: signer.secret_key },
      signature: { packed_hex: "00", public_key: "edpk", signature: "edsig" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error_code, "HOLD_KEYS");
  });
});
