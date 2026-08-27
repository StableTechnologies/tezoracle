import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifySignature } from "@taquito/utils";

import {
  PackError,
  packPayload,
  packUnchecked,
  parseLogicalPayload,
  type PackablePayload,
} from "../../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const gv01 = JSON.parse(readFileSync(join(root, "tests/packing/vectors/GV-01.json"), "utf8")) as {
  payload: PackablePayload;
  packed_hex: string;
};
const keys = JSON.parse(readFileSync(join(root, "tests/packing/keys/ed25519.test.json"), "utf8")) as {
  public_key: string;
  signatures: Record<string, { edsig: string }>;
};

const original = parseLogicalPayload(gv01.payload);
const originalSig = keys.signatures["GV-01"]?.edsig;
assert.ok(originalSig);

type Case = {
  field: string;
  mutate: (payload: PackablePayload) => PackablePayload;
  packerCode?: PackError["code"];
};

function clone(payload: PackablePayload): PackablePayload {
  return JSON.parse(JSON.stringify(payload)) as PackablePayload;
}

const cases: Case[] = [
  {
    field: "domain",
    mutate: (payload) => ({ ...payload, domain: "TEZORACLE_V2" }),
    packerCode: "DOMAIN",
  },
  {
    field: "chain_id",
    mutate: (payload) => ({ ...payload, chain_id: "NetXdQprcVkpaWU" }),
  },
  {
    field: "oracle_address",
    mutate: (payload) => ({ ...payload, oracle_address: "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton" }),
  },
  {
    field: "config_version",
    mutate: (payload) => ({ ...payload, config_version: "2" }),
  },
  {
    field: "policy_hash",
    mutate: (payload) => ({ ...payload, policy_hash: payload.policy_hash.replace(/[0-9a-f]$/, (ch) => (ch === "0" ? "1" : "0")) }),
  },
  {
    field: "publication_group",
    mutate: (payload) => ({ ...payload, publication_group: "USDTZ" }),
    packerCode: "ASSETS_SET",
  },
  {
    field: "round",
    mutate: (payload) => ({ ...payload, round: "2" }),
  },
  {
    field: "valid_from",
    mutate: (payload) => ({ ...payload, valid_from: String(Number(payload.valid_from) + 1) }),
  },
  {
    field: "valid_until",
    mutate: (payload) => ({ ...payload, valid_until: String(Number(payload.valid_until) + 1) }),
  },
  {
    field: "evidence_digest",
    mutate: (payload) => ({
      ...payload,
      evidence_digest: payload.evidence_digest.replace(/[0-9a-f]$/, (ch) => (ch === "0" ? "1" : "0")),
    }),
  },
  {
    field: "asset_order",
    mutate: (payload) => {
      const [a, b, c] = payload.assets;
      assert.ok(a && b && c);
      return { ...payload, assets: [c, a, b] };
    },
    packerCode: "ASSETS_SET",
  },
  {
    field: "asset_id",
    mutate: (payload) => {
      const assets = payload.assets.map((asset, index) =>
        index === 0 ? { ...asset, asset_id: "BTC_USDX" } : asset,
      );
      return { ...payload, assets };
    },
    packerCode: "ASSET_ID",
  },
  {
    field: "price",
    mutate: (payload) => {
      const first = payload.assets[0];
      assert.ok(first);
      const assets = payload.assets.map((asset, index) =>
        index === 0 ? { ...asset, price: String(BigInt(first.price) + 1n) } : asset,
      );
      return { ...payload, assets };
    },
  },
  {
    field: "decimals",
    mutate: (payload) => {
      const assets = payload.assets.map((asset, index) => (index === 0 ? { ...asset, decimals: "7" } : asset));
      return { ...payload, assets };
    },
    packerCode: "DECIMALS",
  },
  {
    field: "observation_time",
    mutate: (payload) => {
      const first = payload.assets[0];
      assert.ok(first);
      const assets = payload.assets.map((asset, index) =>
        index === 0 ? { ...asset, observation_time: String(Number(first.observation_time) + 1) } : asset,
      );
      return { ...payload, assets };
    },
  },
];

test("signed-field tamper matrix: packed bytes change and the original signature fails", () => {
  assert.equal(verifySignature(gv01.packed_hex, keys.public_key, originalSig), true);

  for (const row of cases) {
    const mutated = row.mutate(clone(original));
    if (row.packerCode) {
      assert.throws(
        () => packPayload(mutated),
        (error: unknown) => error instanceof PackError && error.code === row.packerCode,
        row.field,
      );
    }
    const packed = packUnchecked(mutated);
    assert.notEqual(packed.packedHex, gv01.packed_hex, `${row.field} must change PACK bytes`);
    assert.equal(
      verifySignature(packed.packedHex, keys.public_key, originalSig),
      false,
      `${row.field} must invalidate the original signature`,
    );
  }
});
