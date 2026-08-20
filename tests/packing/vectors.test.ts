import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifySignature } from "@taquito/utils";

import { loadSnapshot } from "../../src/config/validate.js";
import {
  ASSET_DECIMALS,
  GROUP_ASSETS,
  PACKING_STATUS,
  PackError,
  packPayload,
  parseLogicalPayload,
} from "../../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vectorsDir = join(root, "tests/packing/vectors");
const keysPath = join(root, "tests/packing/keys/ed25519.test.json");

type Vector = {
  id: string;
  payload: unknown;
  micheline: unknown;
  packed_hex: string;
  blake2b_hex: string;
};

function loadVectors(): Vector[] {
  return readdirSync(vectorsDir)
    .filter((name) => /^GV-\d+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(vectorsDir, name), "utf8")) as Vector);
}

test("packing status is frozen after golden vectors", () => {
  assert.equal(PACKING_STATUS, "frozen");
});

test("TypeScript PACK matches frozen vectors byte-for-byte", () => {
  for (const vector of loadVectors()) {
    const packed = packPayload(vector.payload);
    assert.equal(packed.packedHex, vector.packed_hex, vector.id);
    assert.equal(packed.blake2bHex, vector.blake2b_hex, vector.id);
    assert.deepEqual(packed.micheline, vector.micheline, vector.id);
  }
});

test("chain_id and oracle_address are in the packed domain", () => {
  const byId = new Map(loadVectors().map((vector) => [vector.id, vector]));
  const gv01 = byId.get("GV-01");
  const gv04 = byId.get("GV-04");
  const gv05 = byId.get("GV-05");
  assert.ok(gv01 && gv04 && gv05);
  assert.notEqual(gv01.packed_hex, gv04.packed_hex);
  assert.notEqual(gv01.blake2b_hex, gv04.blake2b_hex);
  assert.notEqual(gv01.packed_hex, gv05.packed_hex);
  assert.equal((gv01.payload as { chain_id: string }).chain_id, "NetXnHfVqm9iesp");
  assert.equal((gv04.payload as { chain_id: string }).chain_id, "NetXdQprcVkpaWU");
});

test("test-only ed25519 signatures verify over packed bytes", () => {
  const keys = JSON.parse(readFileSync(keysPath, "utf8")) as {
    public_key: string;
    signatures: Record<string, { edsig: string }>;
  };
  for (const vector of loadVectors()) {
    const signature = keys.signatures[vector.id];
    assert.ok(signature, vector.id);
    assert.equal(verifySignature(vector.packed_hex, keys.public_key, signature.edsig), true, vector.id);
  }
});

test("packing constants match the parameter register", () => {
  const { snapshot, errors } = loadSnapshot(join(root, "config"));
  assert.equal(errors.length, 0);
  assert.deepEqual(snapshot.register.publication_groups.CORE.asset_ids, [...GROUP_ASSETS.CORE]);
  for (const [assetId, decimals] of Object.entries(ASSET_DECIMALS)) {
    const asset = snapshot.assets[assetId];
    assert.ok(asset, assetId);
    assert.equal(asset.decimals, decimals, assetId);
  }
});

test("packer rejects reorder, extra fields, and non-canonical values", () => {
  const [core] = loadVectors().filter((vector) => vector.id === "GV-01");
  assert.ok(core);
  const base = parseLogicalPayload(core.payload);
  const first = base.assets[0];
  const second = base.assets[1];
  const third = base.assets[2];
  assert.ok(first && second && third);

  const reorder = {
    ...base,
    assets: [third, first, second],
  };
  assert.throws(() => packPayload(reorder), (error: unknown) => error instanceof PackError && error.code === "ASSETS_SET");

  assert.throws(
    () => packPayload({ ...base, extra: true }),
    (error: unknown) => error instanceof PackError && error.code === "PACK",
  );
  assert.throws(
    () => packPayload({ ...base, domain: "TEZFIN_ORACLE_V1" }),
    (error: unknown) => error instanceof PackError && error.code === "DOMAIN",
  );
  assert.throws(
    () => packPayload({ ...base, chain_id: "NetXdQprjJrJcWw" }),
    (error: unknown) => error instanceof PackError && error.code === "CHAIN",
  );
  assert.throws(
    () => packPayload({ ...base, oracle_address: "tz1hmZ1GP7qdUBMcTHGryzvo8gAGLPs3CzYa" }),
    (error: unknown) => error instanceof PackError && error.code === "ORACLE",
  );
  assert.throws(
    () => packPayload({ ...base, assets: base.assets.map((asset) => ({ ...asset, price: 750000 })) }),
    (error: unknown) => error instanceof PackError && error.code === "PRICE",
  );
  const zeroPrice = {
    ...base,
    assets: base.assets.map((asset, index) => (index === 0 ? { ...asset, price: "0" } : asset)),
  };
  assert.throws(() => packPayload(zeroPrice), (error: unknown) => error instanceof PackError && error.code === "PRICE");
});
