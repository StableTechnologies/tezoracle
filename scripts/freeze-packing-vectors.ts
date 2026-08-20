/**
 * Freeze packing golden vectors from the TypeScript reference packer.
 * SmartPy tests must match these bytes independently.
 *
 * Usage: npx tsx scripts/freeze-packing-vectors.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemorySigner } from "@taquito/signer";

import { blake2b256Hex, packPayload, PAYLOAD_MICHELSON_TYPE } from "../src/packing/index.js";
import type { LogicalPayload } from "../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vectorsDir = join(root, "tests/packing/vectors");
const keysDir = join(root, "tests/packing/keys");

const ORACLE_A = "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy";
const ORACLE_B = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
const GHOSTNET = "NetXnHfVqm9iesp";
const MAINNET = "NetXdQprcVkpaWU";

const TEST_SECRET =
  "edskSAoiNS22migarRXPB9Uhs7A1Q3fP23hxQGK5Ji8X5gHTXzpA4wyuyR1unDoSbSeYc839zaVwF68kdxgL2CHZLoTvZTu4tJ";

function h(label: string): string {
  return blake2b256Hex(new TextEncoder().encode(label));
}

function coreAssets(prices: { btc: string; usdt: string; xtz: string }, obs: { btc: string; usdt: string; xtz: string }) {
  return [
    { asset_id: "BTC_USD", price: prices.btc, decimals: "6", observation_time: obs.btc },
    { asset_id: "USDT_USD", price: prices.usdt, decimals: "6", observation_time: obs.usdt },
    { asset_id: "XTZ_USD", price: prices.xtz, decimals: "6", observation_time: obs.xtz },
  ];
}

const logical: Array<{ id: string; description: string; payload: LogicalPayload }> = [
  {
    id: "GV-01",
    description: "CORE batch on Ghostnet with typical six-decimal prices",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_A,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "CORE",
      round: "1",
      valid_from: "1786680000",
      valid_until: "1786680180",
      evidence_digest: h("GV-01-evidence"),
      assets: coreAssets(
        { btc: "65000000000", usdt: "1000100", xtz: "750000" },
        { btc: "1786679900", usdt: "1786679920", xtz: "1786679850" },
      ),
    },
  },
  {
    id: "GV-02",
    description: "USDTZ single-asset batch",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_A,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "USDTZ",
      round: "1",
      valid_from: "1786680000",
      valid_until: "1786680180",
      evidence_digest: h("GV-02-evidence"),
      assets: [{ asset_id: "USDTZ_USD", price: "1000000", decimals: "6", observation_time: "1786679900" }],
    },
  },
  {
    id: "GV-03",
    description: "TZBTC single-asset batch",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_A,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "TZBTC",
      round: "1",
      valid_from: "1786680000",
      valid_until: "1786680180",
      evidence_digest: h("GV-03-evidence"),
      assets: [{ asset_id: "TZBTC_USD", price: "65000000000", decimals: "6", observation_time: "1786679900" }],
    },
  },
  {
    id: "GV-04",
    description: "Same CORE economics as GV-01 on mainnet chain_id (domain separation)",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: MAINNET,
      oracle_address: ORACLE_A,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "CORE",
      round: "1",
      valid_from: "1786680000",
      valid_until: "1786680180",
      evidence_digest: h("GV-01-evidence"),
      assets: coreAssets(
        { btc: "65000000000", usdt: "1000100", xtz: "750000" },
        { btc: "1786679900", usdt: "1786679920", xtz: "1786679850" },
      ),
    },
  },
  {
    id: "GV-05",
    description: "Same CORE economics as GV-01 against a different oracle address",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_B,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "CORE",
      round: "1",
      valid_from: "1786680000",
      valid_until: "1786680180",
      evidence_digest: h("GV-01-evidence"),
      assets: coreAssets(
        { btc: "65000000000", usdt: "1000100", xtz: "750000" },
        { btc: "1786679900", usdt: "1786679920", xtz: "1786679850" },
      ),
    },
  },
  {
    id: "GV-06",
    description: "Skipped round after an outage (round 9) with config_version 2",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_A,
      config_version: "2",
      policy_hash: h("tezoracle-test-policy-v2"),
      publication_group: "CORE",
      round: "9",
      valid_from: "1786681000",
      valid_until: "1786681180",
      evidence_digest: h("GV-06-evidence"),
      assets: coreAssets(
        { btc: "64900000000", usdt: "999900", xtz: "740000" },
        { btc: "1786680900", usdt: "1786680910", xtz: "1786680890" },
      ),
    },
  },
  {
    id: "GV-07",
    description: "Timestamp boundary: observation_time = 1, one-second validity window",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_A,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "USDTZ",
      round: "2",
      valid_from: "2",
      valid_until: "3",
      evidence_digest: h("GV-07-evidence"),
      assets: [{ asset_id: "USDTZ_USD", price: "900000", decimals: "6", observation_time: "1" }],
    },
  },
  {
    id: "GV-08",
    description: "CORE decimal/price bounds: minimum register prices",
    payload: {
      domain: "TEZORACLE_V1",
      chain_id: GHOSTNET,
      oracle_address: ORACLE_A,
      config_version: "1",
      policy_hash: h("tezoracle-test-policy-v1"),
      publication_group: "CORE",
      round: "3",
      valid_from: "1786680000",
      valid_until: "1786680180",
      evidence_digest: h("GV-08-evidence"),
      assets: coreAssets(
        { btc: "1000000000", usdt: "900000", xtz: "10000" },
        { btc: "1786679900", usdt: "1786679900", xtz: "1786679900" },
      ),
    },
  },
];

async function main(): Promise<void> {
  mkdirSync(vectorsDir, { recursive: true });
  mkdirSync(keysDir, { recursive: true });

  writeFileSync(
    join(vectorsDir, "michelson_type.json"),
    `${JSON.stringify(PAYLOAD_MICHELSON_TYPE, null, 2)}\n`,
  );

  const signer = await InMemorySigner.fromSecretKey(TEST_SECRET);
  const publicKey = await signer.publicKey();
  const publicKeyHash = await signer.publicKeyHash();
  const signatures: Record<string, { sig: string; edsig: string; sbytes: string }> = {};

  for (const spec of logical) {
    const packed = packPayload(spec.payload);
    const signed = await signer.sign(packed.packedHex);
    signatures[spec.id] = {
      sig: signed.sig,
      edsig: signed.prefixSig,
      sbytes: signed.sbytes,
    };
    const vector = {
      id: spec.id,
      description: spec.description,
      payload: spec.payload,
      micheline: packed.micheline,
      packed_hex: packed.packedHex,
      blake2b_hex: packed.blake2bHex,
    };
    writeFileSync(join(vectorsDir, `${spec.id}.json`), `${JSON.stringify(vector, null, 2)}\n`);
    console.log(spec.id, packed.packedHex.slice(0, 10) + "...", packed.blake2bHex);
  }

  writeFileSync(
    join(keysDir, "ed25519.test.json"),
    `${JSON.stringify(
      {
        label: "tezoracle-packing-test-ed25519-v1",
        curve: "ed25519",
        note: "TEST ONLY. Not a production key. Used solely to freeze CHECK_SIGNATURE vectors. Do not reuse on any network with value.",
        secret_key: TEST_SECRET,
        public_key: publicKey,
        public_key_hash: publicKeyHash,
        signatures,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
