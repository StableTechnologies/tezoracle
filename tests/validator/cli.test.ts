import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifySignature } from "@taquito/utils";

import { loadCommittedRegister } from "../../src/config/policy.js";
import { packConfigIntent } from "../../src/packing/governance.js";
import { runCli } from "../../src/validator/cli.js";
import { ValidatorError } from "../../src/validator/errors.js";
import {
  buildPinnedInit,
  type GovernanceSidecar,
} from "../../src/validator/governance.js";
import { CONFIG_DIR, FIXTURES_PATH, NOW, ROOT } from "./helpers.js";

test("CLI --help exits 0", async () => {
  const code = await runCli(["--help"]);
  assert.equal(code, 0);
});

test("CLI derive against deterministic fixtures prints CORE prices", async () => {
  const previous = process.stdout.write;
  let captured = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await runCli([
      "derive",
      "--group",
      "CORE",
      "--fixtures",
      FIXTURES_PATH,
      "--now",
      String(NOW),
    ]);
    assert.equal(code, 0);
    const parsed = JSON.parse(captured) as { ok: boolean; assets: { asset_id: string; price: string }[] };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.assets.find((asset) => asset.asset_id === "XTZ_USD")?.price, "750200");
  } finally {
    process.stdout.write = previous;
  }
});

test("CLI verify refuses a mutated candidate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-"));
  const candidatePath = join(dir, "candidate.json");
  writeFileSync(
    candidatePath,
    JSON.stringify({
      payload: { domain: "TEZORACLE_V1" },
      evidence: { domain: "TEZORACLE_EVIDENCE_V1" },
      sources: [],
    }),
  );
  const previous = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    const code = await runCli(["verify", "--candidate", candidatePath, "--fixtures", FIXTURES_PATH, "--now", String(NOW)]);
    assert.equal(code, 1);
  } finally {
    process.stdout.write = previous;
  }
});

test("CLI derive retries transient failures and still fails closed if they persist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-retry-"));
  const dexStatePath = join(dir, "dex-state.json");
  let stderrOut = "";
  const previous = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrOut += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    // No TzKT fixtures are registered for USDTZ's pools, so every pool
    // observation fails and the group stays INSUFFICIENT on every attempt --
    // this only exercises that retries happen and eventually give up.
    await assert.rejects(
      () =>
        runCli([
          "derive",
          "--group",
          "USDTZ",
          "--fixtures",
          FIXTURES_PATH,
          "--dex-state",
          dexStatePath,
          "--retries",
          "2",
          "--retry-delay-ms",
          "1",
        ]),
      (error: unknown) => error instanceof ValidatorError && error.code === "INSUFFICIENT",
    );
  } finally {
    process.stderr.write = previous;
  }
  const retryMessages = stderrOut.split("\n").filter((line) => line.includes("derive attempt"));
  assert.equal(retryMessages.length, 2);
});

test("CLI sign-governance rebuilds config from local pin", async () => {
  const keys = JSON.parse(
    readFileSync(join(ROOT, "tests/packing/keys/ed25519.test.json"), "utf8"),
  ) as { secret_key: string; public_key: string };
  const { snapshot } = loadCommittedRegister(CONFIG_DIR);
  const sidecar: GovernanceSidecar = {
    schema_version: 1,
    admin: "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC",
    guardian: "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC",
    threshold_n: "1",
    threshold_m: "1",
    signers: {
      "0": { public_key: keys.public_key, class_id: "A", active: true },
    },
    class_minima: {},
  };
  const intent = {
    domain: "TEZORACLE_CONFIG_V1" as const,
    chain_id: "NetXsqzbfFenSTS",
    oracle_address: "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy",
    current_config_version: String(snapshot.register.config_version - 1),
    governance_nonce: "0",
    valid_until: String(NOW + 600),
    init: buildPinnedInit(snapshot, sidecar),
  };
  const packed = packConfigIntent(intent);
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-governance-"));
  const artifactPath = join(dir, "intent.json");
  const sidecarPath = join(dir, "sidecar.json");
  writeFileSync(artifactPath, JSON.stringify({ intent, packed_hex: packed.packedHex }));
  writeFileSync(sidecarPath, JSON.stringify(sidecar));

  const previousWrite = process.stdout.write;
  const previousSecret = process.env.TEZORACLE_SIGNER_SECRET_KEY;
  let captured = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.env.TEZORACLE_SIGNER_SECRET_KEY = keys.secret_key;
  try {
    const code = await runCli([
      "sign-governance",
      "--intent",
      artifactPath,
      "--sidecar",
      sidecarPath,
      "--config",
      CONFIG_DIR,
      "--now",
      String(NOW),
    ]);
    assert.equal(code, 0);
  } finally {
    process.stdout.write = previousWrite;
    if (previousSecret === undefined) delete process.env.TEZORACLE_SIGNER_SECRET_KEY;
    else process.env.TEZORACLE_SIGNER_SECRET_KEY = previousSecret;
  }
  const result = JSON.parse(captured) as {
    ok: boolean;
    packed_hex: string;
    public_key: string;
    signature: { edsig: string };
  };
  assert.equal(result.ok, true);
  assert.equal(result.packed_hex, packed.packedHex);
  assert.equal(
    verifySignature(result.packed_hex, result.public_key, result.signature.edsig),
    true,
  );
});