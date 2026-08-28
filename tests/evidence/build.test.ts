import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCommittedRegister } from "../../src/config/policy.js";
import {
  EvidenceError,
  buildSharedManifest,
  hashSharedManifest,
  parseSharedManifest,
} from "../../src/evidence/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const builderSource = readFileSync(join(root, "src/evidence/build.ts"), "utf8");
const gv01 = parseSharedManifest(
  JSON.parse(readFileSync(join(root, "tests/packing/evidence/GV-01.json"), "utf8")),
);

test("production builder is not a candidate-payload synthesizer", () => {
  assert.equal(builderSource.includes("LogicalPayload"), false);
  assert.equal(builderSource.includes("payload.assets"), false);
  assert.match(builderSource, /independently collected/);
});

test("production builder consumes independently collected observations", () => {
  const { snapshot, policyHash } = loadCommittedRegister();
  const rebuilt = buildSharedManifest({
    snapshot,
    policy_hash: policyHash,
    publication_group: gv01.publication_group,
    round: gv01.round,
    assets: gv01.assets.map((asset) => ({
      asset_id: asset.asset_id,
      price: asset.price,
      decimals: asset.decimals,
      observation_time: asset.observation_time,
      sources: asset.sources,
      excluded: asset.excluded,
    })),
  });
  assert.equal(hashSharedManifest(rebuilt), hashSharedManifest(gv01));
});

test("production builder fail-closes below the register minimum", () => {
  const { snapshot, policyHash } = loadCommittedRegister();
  const btc = gv01.assets[0];
  assert.ok(btc);
  assert.throws(
    () =>
      buildSharedManifest({
        snapshot,
        policy_hash: policyHash,
        publication_group: gv01.publication_group,
        round: gv01.round,
        assets: gv01.assets.map((asset) =>
          asset.asset_id === btc.asset_id
            ? { ...asset, sources: asset.sources.slice(0, 1), excluded: asset.excluded }
            : { ...asset, sources: asset.sources, excluded: asset.excluded },
        ),
      }),
    (error: unknown) => error instanceof EvidenceError && error.code === "EVIDENCE_MIN",
  );
});
