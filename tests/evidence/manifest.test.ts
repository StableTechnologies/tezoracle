import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCommittedRegister } from "../../src/config/policy.js";
import {
  EvidenceError,
  hashSharedManifest,
  parseSharedManifest,
  verifySharedManifest,
  type SharedEvidenceManifest,
} from "../../src/evidence/index.js";
import { parseLogicalPayload } from "../../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const gv01 = JSON.parse(readFileSync(join(root, "tests/packing/vectors/GV-01.json"), "utf8")) as { payload: unknown };
const manifest = parseSharedManifest(
  JSON.parse(readFileSync(join(root, "tests/packing/evidence/GV-01.json"), "utf8")),
);
const signerLocal = JSON.parse(
  readFileSync(join(root, "tests/packing/evidence/GV-01.signer-local.json"), "utf8"),
) as { domain: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("top-level evidence_digest binds every CORE asset to sources, times, decimals, and policy", () => {
  const { snapshot, policyHash } = loadCommittedRegister();
  const payload = parseLogicalPayload(gv01.payload);
  verifySharedManifest(manifest, payload, snapshot, policyHash);
  assert.equal(manifest.assets.length, payload.assets.length);
  for (const asset of manifest.assets) {
    assert.ok(asset.sources.length >= 2, asset.asset_id);
    assert.equal(asset.calculation.oldest_observation_time, asset.observation_time);
    assert.equal(asset.decimals, snapshot.assets[asset.asset_id]?.decimals);
    assert.equal(asset.calculation.aggregation, "median_lower");
    for (const source of asset.sources) {
      const registered = snapshot.assets[asset.asset_id]?.sources.find((item) => item.source_id === source.source_id);
      assert.ok(registered, source.source_id);
      assert.equal(source.endpoint, registered?.endpoint);
    }
  }
});

test("mutating one asset's source, time, decimals, or calculation policy changes the digest", () => {
  const baseline = hashSharedManifest(manifest);
  const source = clone(manifest);
  const first = source.assets[0]?.sources[0];
  assert.ok(first);
  first.endpoint = "https://evil.example/api";
  assert.notEqual(hashSharedManifest(source), baseline);

  const time = clone(manifest);
  const timed = time.assets[1];
  assert.ok(timed?.sources[0]);
  timed.sources[0].venue_observation_time += 1;
  timed.observation_time += 1;
  timed.calculation.oldest_observation_time += 1;
  assert.notEqual(hashSharedManifest(time), baseline);

  const decimals = clone(manifest);
  const priced = decimals.assets[2];
  assert.ok(priced);
  priced.decimals = 7;
  assert.notEqual(hashSharedManifest(decimals), baseline);

  const policy = clone(manifest);
  const calc = policy.assets[0];
  assert.ok(calc);
  calc.calculation.aggregation = "mean";
  assert.notEqual(hashSharedManifest(policy), baseline);
});

test("signer-local independently collected evidence is not hashed into evidence_digest", () => {
  assert.equal(signerLocal.domain, "TEZORACLE_SIGNER_EVIDENCE_V1");
  const mixed = { quorum: manifest, signer_local: signerLocal } as unknown as SharedEvidenceManifest;
  assert.notEqual(hashSharedManifest(mixed), hashSharedManifest(manifest));
  assert.equal(hashSharedManifest(manifest), parseLogicalPayload(gv01.payload).evidence_digest);
});

function isCode(code: string) {
  return (error: unknown) => error instanceof EvidenceError && error.code === code;
}

test("verification fail-closes on digest, min observations, and source/policy fields", () => {
  const { snapshot, policyHash } = loadCommittedRegister();
  const payload = parseLogicalPayload(gv01.payload);

  const digestMismatch = { ...payload, evidence_digest: "11".repeat(32) };
  assert.throws(() => verifySharedManifest(manifest, digestMismatch, snapshot, policyHash), isCode("EVIDENCE_DIGEST"));

  const reduced = clone(manifest);
  const first = reduced.assets[0];
  assert.ok(first?.sources[0]);
  first.sources = first.sources.slice(0, 1);
  first.calculation.contributing_source_ids = first.sources.map((source) => source.source_id);
  const reducedPayload = { ...payload, evidence_digest: hashSharedManifest(reduced) };
  assert.throws(() => verifySharedManifest(reduced, reducedPayload, snapshot, policyHash), isCode("EVIDENCE_MIN"));

  const identity = clone(manifest);
  const source = identity.assets[0]?.sources[0];
  assert.ok(source);
  source.venue = "NotBinance";
  const identityPayload = { ...payload, evidence_digest: hashSharedManifest(identity) };
  assert.throws(() => verifySharedManifest(identity, identityPayload, snapshot, policyHash), isCode("EVIDENCE_SOURCE"));

  const policy = clone(manifest);
  const calc = policy.assets[0];
  assert.ok(calc);
  calc.calculation.min_independent_observations = 1;
  const policyPayload = { ...payload, evidence_digest: hashSharedManifest(policy) };
  assert.throws(() => verifySharedManifest(policy, policyPayload, snapshot, policyHash), isCode("EVIDENCE_POLICY"));
});
