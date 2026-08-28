import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { verifySignature } from "@taquito/utils";

import { packPayload } from "../../src/packing/index.js";
import { candidateFromDerivation, verifyCandidate } from "../../src/validator/candidate.js";
import { derivePublicationGroup } from "../../src/validator/derive.js";
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
    chain_id: "NetXnHfVqm9iesp",
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
