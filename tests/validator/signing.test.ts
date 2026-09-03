import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { verifySignature } from "@taquito/utils";

import { packPayload } from "../../src/packing/index.js";
import { packConfigIntent } from "../../src/packing/governance.js";
import { loadCommittedRegister } from "../../src/config/policy.js";
import { candidateFromDerivation, verifyCandidate } from "../../src/validator/candidate.js";
import { derivePublicationGroup } from "../../src/validator/derive.js";
import {
  buildPinnedInit,
  loadGovernanceSidecar,
  parseGovernanceArtifact,
  rebuildAndPackGovernanceIntent,
  sidecarPathForVersion,
  signGovernanceArtifact,
  type GovernanceSidecar,
} from "../../src/validator/governance.js";
import { assertFreshRound, commitRound, signPackedPayload } from "../../src/validator/signer.js";
import { ValidatorError } from "../../src/validator/errors.js";
import { NOW, ROOT, coreMockTransport, pinnedRegister } from "./helpers.js";

const keys = JSON.parse(readFileSync(join(ROOT, "tests/packing/keys/ed25519.test.json"), "utf8")) as {
  secret_key: string;
  public_key: string;
  signatures: Record<string, { edsig: string; sig: string; sbytes: string }>;
};

const vectorsDir = join(ROOT, "tests/packing/vectors");

test("Class A signs frozen packing vectors with the test-only key", async () => {
  const files = readdirSync(vectorsDir).filter((name) => /^GV-\d+\.json$/.test(name));
  for (const name of files) {
    const vector = JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as {
      id: string;
      payload: unknown;
      packed_hex: string;
    };
    const packed = packPayload(vector.payload);
    assert.equal(packed.packedHex, vector.packed_hex, vector.id);
    const signed = await signPackedPayload({
      payload: packed.payload,
      secretKey: keys.secret_key,
      signerId: "class-a-test",
      state: {},
      now: NOW,
    });
    const expected = keys.signatures[vector.id];
    assert.ok(expected, vector.id);
    assert.equal(signed.signature.edsig, expected.edsig, vector.id);
    assert.equal(signed.signature.sig, expected.sig, vector.id);
    assert.equal(signed.signature.sbytes, expected.sbytes, vector.id);
    assert.equal(verifySignature(vector.packed_hex, keys.public_key, signed.signature.edsig), true, vector.id);
  }
});

test("local round tracking refuses reuse and accepts a later round", async () => {
  const files = readdirSync(vectorsDir).filter((name) => name.startsWith("GV-01"));
  const vector = JSON.parse(readFileSync(join(vectorsDir, files[0]!), "utf8")) as { payload: unknown };
  const packed = packPayload(vector.payload);
  const state = commitRound({}, packed.payload.publication_group, packed.payload.round);
  assert.throws(
    () => assertFreshRound(state, packed.payload.publication_group, packed.payload.round),
    ValidatorError,
  );
  const later = { ...packed.payload, round: "2" };
  const signed = await signPackedPayload({
    payload: later,
    secretKey: keys.secret_key,
    signerId: "class-a-test",
    state,
    now: NOW,
  });
  assert.equal(signed.local_record.decision, "sign");
  assert.equal(signed.local_record.error_code, null);
});

test("verified mock CORE candidate can be signed", async () => {
  const { snapshot, policy_hash } = pinnedRegister();
  const derivation = await derivePublicationGroup({
    snapshot,
    group: "CORE",
    transport: coreMockTransport(),
    now: NOW,
    round: "1",
  });
  const document = candidateFromDerivation({
    derivation,
    chain_id: "NetXsqzbfFenSTS",
    oracle_address: "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy",
    round: "1",
    valid_from: String(NOW),
    valid_until: String(NOW + snapshot.register.time_policy.validity_window_seconds),
  });
  const verified = await verifyCandidate({
    snapshot,
    candidate: document,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  const signed = await signPackedPayload({
    payload: verified.payload,
    secretKey: keys.secret_key,
    signerId: "class-a-test",
    state: {},
    now: NOW,
    localPrices: Object.fromEntries(verified.local.assets.map((asset) => [asset.asset_id, asset.price.toString()])),
    localTimes: Object.fromEntries(verified.local.assets.map((asset) => [asset.asset_id, asset.observation_time])),
    deviationBps: verified.deviation_bps_by_asset,
    localSources: verified.local.assets.flatMap((asset) => asset.sources),
  });
  assert.equal(signed.payload.policy_hash, policy_hash);
  assert.equal(verifySignature(signed.packed_hex, signed.public_key, signed.signature.edsig), true);
  assert.equal(signed.local_record.decision, "sign");
});

function governanceFixture() {
  const { snapshot } = loadCommittedRegister();
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
    governance_nonce: "7",
    valid_until: String(NOW + 600),
    init: buildPinnedInit(snapshot, sidecar),
  };
  const packed = packConfigIntent(intent);
  return {
    snapshot,
    sidecar,
    artifact: { intent, packed_hex: packed.packedHex },
  };
}

test("governance signer rebuilds config from local pin and signs its own PACK", async () => {
  const fixture = governanceFixture();
  const signed = await signGovernanceArtifact({
    ...fixture,
    secretKey: keys.secret_key,
    now: NOW,
  });
  assert.equal(signed.packed_hex, fixture.artifact.packed_hex);
  assert.equal(verifySignature(signed.packed_hex, keys.public_key, signed.signature.edsig), true);
  assert.equal(
    (signed.intent as { init: { policy_hash: string } }).init.policy_hash,
    fixture.artifact.intent.init.policy_hash,
  );
});

test("governance signer refuses artifact bytes or config outside its local pin", () => {
  const fixture = governanceFixture();
  const changedArtifact = {
    ...fixture.artifact,
    intent: {
      ...fixture.artifact.intent,
      init: { ...fixture.artifact.intent.init, threshold_n: "2" },
    },
  };
  changedArtifact.packed_hex = packConfigIntent(changedArtifact.intent).packedHex;
  assert.throws(
    () =>
      rebuildAndPackGovernanceIntent({
        artifact: changedArtifact,
        snapshot: fixture.snapshot,
        sidecar: fixture.sidecar,
        now: NOW,
      }),
    (error: unknown) => error instanceof ValidatorError && error.code === "CANDIDATE_MISMATCH",
  );
  assert.throws(
    () =>
      rebuildAndPackGovernanceIntent({
        artifact: { ...fixture.artifact, packed_hex: `05${"00".repeat(8)}` },
        snapshot: fixture.snapshot,
        sidecar: fixture.sidecar,
        now: NOW,
      }),
    (error: unknown) => error instanceof ValidatorError && error.code === "CANDIDATE_MISMATCH",
  );
});

test("committed governance examples PACK against the current register pin", () => {
  const { snapshot } = loadCommittedRegister();
  const artifact = parseGovernanceArtifact(
    JSON.parse(readFileSync(join(ROOT, "config/governance/intent.example.json"), "utf8")) as unknown,
  );
  const sidecar = loadGovernanceSidecar(
    sidecarPathForVersion(join(ROOT, "config"), snapshot.register.config_version),
  );
  const packed = rebuildAndPackGovernanceIntent({
    artifact,
    snapshot,
    sidecar,
    now: NOW,
  });
  assert.equal(packed.packedHex, artifact.packed_hex);
});
