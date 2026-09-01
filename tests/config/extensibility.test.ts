import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadSnapshot } from "../../src/config/validate.js";
import { packPayload } from "../../src/packing/index.js";
import { policyFromSnapshot } from "../../src/config/policy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configDir = join(root, "config");

function cloneConfig(extraGroup: string, extraAssetId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-register-"));
  mkdirSync(join(dir, "assets"));
  const register = JSON.parse(readFileSync(join(configDir, "register.json"), "utf8")) as {
    assets: string[];
    publication_groups: Record<string, { asset_ids: string[] }>;
  };
  register.publication_groups[extraGroup] = { asset_ids: [extraAssetId] };
  register.assets = [...register.assets, extraAssetId].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  writeFileSync(join(dir, "register.json"), JSON.stringify(register, null, 2));
  writeFileSync(join(dir, "schema.json"), readFileSync(join(configDir, "schema.json")));
  for (const id of register.assets) {
    if (id === extraAssetId) continue;
    writeFileSync(join(dir, "assets", `${id}.json`), readFileSync(join(configDir, "assets", `${id}.json`)));
  }
  const template = JSON.parse(readFileSync(join(configDir, "assets/USDTZ_USD.json"), "utf8")) as Record<string, unknown>;
  template.asset_id = extraAssetId;
  template.group = extraGroup;
  writeFileSync(join(dir, "assets", `${extraAssetId}.json`), JSON.stringify(template, null, 2));
  return dir;
}

test("a new publication group and asset id validate without packer redesign", () => {
  const dir = cloneConfig("FUTURE", "FUT_USD");
  const { snapshot, errors } = loadSnapshot(dir);
  assert.deepEqual(errors, [], errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  assert.deepEqual(snapshot.register.publication_groups.FUTURE?.asset_ids, ["FUT_USD"]);
  assert.equal(snapshot.assets.FUT_USD?.group, "FUTURE");

  const policy = policyFromSnapshot(snapshot);
  const packed = packPayload(
    {
      domain: "TEZORACLE_V1",
      chain_id: "NetXsqzbfFenSTS",
      oracle_address: "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy",
      config_version: "1",
      policy_hash: "aa".repeat(32),
      publication_group: "FUTURE",
      round: "1",
      valid_from: "10",
      valid_until: "20",
      evidence_digest: "bb".repeat(32),
      assets: [{ asset_id: "FUT_USD", price: "1000000", decimals: "6", observation_time: "9" }],
    },
    policy,
  );
  assert.equal(packed.packedHex.startsWith("05"), true);
});
