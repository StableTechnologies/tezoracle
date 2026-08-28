/**
 * Recompute policy_hash and evidence_digest from committed source documents
 * and fail if golden vectors diverge.
 *
 * Usage: npx tsx scripts/recompute-vector-hashes.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCommittedRegister } from "../src/config/policy.js";
import { hashSharedManifest, parseSharedManifest } from "../src/evidence/index.js";
import { packPayload } from "../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vectorsDir = join(root, "tests/packing/vectors");
const evidenceDir = join(root, "tests/packing/evidence");

type Vector = {
  id: string;
  evidence_id?: string;
  payload: {
    policy_hash: string;
    evidence_digest: string;
  };
  packed_hex: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { policyHash } = loadCommittedRegister();
const vectors = readdirSync(vectorsDir)
  .filter((name) => /^GV-\d+\.json$/.test(name))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as Vector);

if (vectors.length === 0) fail("no golden vectors found");

for (const vector of vectors) {
  const evidenceId = vector.evidence_id ?? vector.id;
  const manifestPath = join(evidenceDir, `${evidenceId}.json`);
  const manifest = parseSharedManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const evidenceDigest = hashSharedManifest(manifest);
  if (vector.payload.policy_hash !== policyHash) {
    fail(`${vector.id}: policy_hash diverges from the committed register snapshot`);
  }
  if (vector.payload.evidence_digest !== evidenceDigest) {
    fail(`${vector.id}: evidence_digest diverges from ${evidenceId}.json`);
  }
  const packed = packPayload(vector.payload);
  if (packed.packedHex !== vector.packed_hex) {
    fail(`${vector.id}: packed bytes diverge from hashes derived from committed sources`);
  }
}

console.log(`ok: ${vectors.length} vectors match register policy_hash ${policyHash}`);
