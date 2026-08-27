import assert from "node:assert/strict";
import test from "node:test";

import { candidateFromDerivation, verifyCandidate } from "../../src/validator/candidate.js";
import { derivePublicationGroup } from "../../src/validator/derive.js";
import { evidenceDigestHex } from "../../src/validator/evidence.js";
import { NOW, coreMockTransport, pinnedRegister } from "./helpers.js";
import { clone } from "./helpers.js";

const GHOSTNET = "NetXnHfVqm9iesp";
const ORACLE = "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy";

async function matchingCandidate() {
  const { snapshot } = pinnedRegister();
  const derivation = await derivePublicationGroup({
    snapshot,
    group: "CORE",
    transport: coreMockTransport(),
    now: NOW,
    round: "1",
  });
  const document = candidateFromDerivation({
    derivation,
    chain_id: GHOSTNET,
    oracle_address: ORACLE,
    round: "1",
    valid_from: String(NOW),
    valid_until: String(NOW + snapshot.register.time_policy.validity_window_seconds),
  });
  return { snapshot, document };
}

test("a self-derived CORE candidate verifies under the pinned policy", async () => {
  const { snapshot, document } = await matchingCandidate();
  const result = await verifyCandidate({
    snapshot,
    candidate: document,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.deviation_bps_by_asset.XTZ_USD, 0);
    assert.equal(result.payload.assets[2]?.price, "750200");
  }
});

test("unknown policy-shaped fields are refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const result = await verifyCandidate({
    snapshot,
    candidate: { ...document, max_signer_deviation_bps: 10_000 },
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "POLICY_PIN");
});

test("altered candidate price is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  mutated.payload.assets[2] = { ...mutated.payload.assets[2]!, price: "760000" };
  mutated.evidence.assets[2] = { ...mutated.evidence.assets[2]!, price: "760000" };
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_LOCAL");
});

test("altered policy hash is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  mutated.payload.policy_hash = "aa".repeat(32);
  mutated.evidence.policy_hash = mutated.payload.policy_hash;
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "POLICY_PIN");
});

test("altered source endpoint is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  const source = mutated.evidence.assets[2]?.sources[0];
  assert.ok(source);
  source.endpoint = "https://evil.example/xtz";
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_ENDPOINT");
});

test("altered observation timestamp is refused when newer than local", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  const newer = NOW - 1;
  mutated.payload.assets[2] = { ...mutated.payload.assets[2]!, observation_time: String(newer) };
  mutated.evidence.assets[2] = {
    ...mutated.evidence.assets[2]!,
    observation_time: newer,
    calculation: { ...mutated.evidence.assets[2]!.calculation, oldest_observation_time: newer },
    sources: mutated.evidence.assets[2]!.sources.map((source) => ({
      ...source,
      venue_observation_time: newer,
      conversion: source.conversion ? { ...source.conversion, factor_observation_time: newer } : null,
    })),
  };
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_TIME");
});

test("altered evidence digest is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  mutated.payload.evidence_digest = "bb".repeat(32);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_DIGEST");
});
