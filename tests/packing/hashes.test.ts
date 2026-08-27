import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCommittedRegister } from "../../src/config/policy.js";
import { bindManifestToPayload, hashSharedManifest, parseSharedManifest } from "../../src/evidence/index.js";
import { packPayload, parseLogicalPayload } from "../../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vectorsDir = join(root, "tests/packing/vectors");
const evidenceDir = join(root, "tests/packing/evidence");

type Vector = {
  id: string;
  evidence_id?: string;
  payload: unknown;
  packed_hex: string;
  blake2b_hex: string;
};

function loadVectors(): Vector[] {
  return readdirSync(vectorsDir)
    .filter((name) => /^GV-\d+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as Vector);
}

test("committed vectors derive policy_hash and evidence_digest from source documents", () => {
  const { snapshot, policyHash } = loadCommittedRegister();
  for (const vector of loadVectors()) {
    const payload = parseLogicalPayload(vector.payload);
    assert.equal(payload.policy_hash, policyHash, vector.id);
    const evidenceId = vector.evidence_id ?? vector.id;
    const manifest = parseSharedManifest(
      JSON.parse(readFileSync(join(evidenceDir, `${evidenceId}.json`), "utf8")),
    );
    assert.equal(hashSharedManifest(manifest), payload.evidence_digest, vector.id);
    bindManifestToPayload(manifest, payload, snapshot, policyHash);
    const packed = packPayload(payload);
    assert.equal(packed.packedHex, vector.packed_hex, vector.id);
    assert.equal(packed.blake2bHex, vector.blake2b_hex, vector.id);
  }
});
