import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { packAssetIntent, packConfigIntent, packInit, packSimpleIntent } from "../../src/packing/governance.js";
import { PackError } from "../../src/packing/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vectorsDir = join(root, "tests/packing/governance");

type Vector = {
  id: string;
  kind: "config" | "simple" | "asset";
  intent: unknown;
  packed_hex: string;
  blake2b_hex: string;
};

function loadVectors(): Vector[] {
  return readdirSync(vectorsDir)
    .filter((name) => /^GI-\d+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as Vector);
}

function pack(vector: Vector) {
  if (vector.kind === "config") return packConfigIntent(vector.intent);
  if (vector.kind === "simple") return packSimpleIntent(vector.intent);
  return packAssetIntent(vector.intent);
}

test("TypeScript PACK matches SmartPy governance vectors byte-for-byte", () => {
  const vectors = loadVectors();
  assert.ok(vectors.length >= 13, "expected frozen GI vectors");
  for (const vector of vectors) {
    const packed = pack(vector);
    assert.equal(packed.packedHex, vector.packed_hex, vector.id);
    assert.equal(packed.blake2bHex, vector.blake2b_hex, vector.id);
  }
});

test("map insertion order does not change packed init", () => {
  const gi05 = loadVectors().find((vector) => vector.id === "GI-05");
  assert.ok(gi05 && gi05.kind === "config");
  const intent = gi05.intent as { init: { assets: Record<string, unknown>; groups: Record<string, unknown> } };
  const assets = intent.init.assets;
  const reversedAssets: Record<string, unknown> = {};
  for (const key of Object.keys(assets).reverse()) reversedAssets[key] = assets[key];
  const groups = intent.init.groups;
  const reversedGroups: Record<string, unknown> = {};
  for (const key of Object.keys(groups).reverse()) reversedGroups[key] = groups[key];
  const left = packInit(intent.init);
  const right = packInit({ ...intent.init, assets: reversedAssets, groups: reversedGroups });
  assert.equal(left.packedHex, right.packedHex);
});

test("asset_id is inside PACK bytes", () => {
  const byId = new Map(loadVectors().map((vector) => [vector.id, vector]));
  const xtz = byId.get("GI-12");
  const btc = byId.get("GI-13");
  assert.ok(xtz && btc);
  assert.notEqual(xtz.packed_hex, btc.packed_hex);
});

test("governance packer rejects unknown fields and price domain", () => {
  const gi01 = loadVectors().find((vector) => vector.id === "GI-01");
  assert.ok(gi01);
  assert.throws(
    () => packConfigIntent({ ...(gi01.intent as object), extra: true }),
    (error: unknown) => error instanceof PackError && error.code === "PACK",
  );
  assert.throws(
    () => packConfigIntent({ ...(gi01.intent as object), domain: "TEZORACLE_V1" }),
    (error: unknown) => error instanceof PackError && error.code === "DOMAIN",
  );
});
