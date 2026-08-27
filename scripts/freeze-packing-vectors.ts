/**
 * Freeze packing golden vectors from the TypeScript reference packer.
 *
 * policy_hash is BLAKE2B-256 of the committed parameter-register snapshot.
 * evidence_digest is BLAKE2B-256 of the committed quorum-shared manifest.
 * Packed Michelson bytes are derived from those hashes. Do not hand-edit hex.
 *
 * Usage: npx tsx scripts/freeze-packing-vectors.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemorySigner } from "@taquito/signer";

import { loadCommittedRegister } from "../src/config/policy.js";
import { buildSharedManifest, hashSharedManifest } from "../src/evidence/index.js";
import { packPayload, PAYLOAD_MICHELSON_TYPE } from "../src/packing/index.js";
import type { LogicalPayload } from "../src/packing/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vectorsDir = join(root, "tests/packing/vectors");
const evidenceDir = join(root, "tests/packing/evidence");
const keysDir = join(root, "tests/packing/keys");

const ORACLE_A = "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy";
const ORACLE_B = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
const GHOSTNET = "NetXnHfVqm9iesp";
const MAINNET = "NetXdQprcVkpaWU";

const TEST_SECRET =
  "edskSAoiNS22migarRXPB9Uhs7A1Q3fP23hxQGK5Ji8X5gHTXzpA4wyuyR1unDoSbSeYc839zaVwF68kdxgL2CHZLoTvZTu4tJ";

const PLACEHOLDER_HASH = "00".repeat(32);

function coreAssets(prices: { btc: string; usdt: string; xtz: string }, obs: { btc: string; usdt: string; xtz: string }) {
  return [
    { asset_id: "BTC_USD", price: prices.btc, decimals: "6", observation_time: obs.btc },
    { asset_id: "USDT_USD", price: prices.usdt, decimals: "6", observation_time: obs.usdt },
    { asset_id: "XTZ_USD", price: prices.xtz, decimals: "6", observation_time: obs.xtz },
  ];
}

type Spec = { id: string; description: string; evidenceId: string; payload: LogicalPayload };

function specs(policyHash: string): Spec[] {
  const withPolicy = (payload: Omit<LogicalPayload, "policy_hash" | "evidence_digest"> & { evidence_digest?: string }): LogicalPayload => ({
    ...payload,
    policy_hash: policyHash,
    evidence_digest: payload.evidence_digest ?? PLACEHOLDER_HASH,
  });

  return [
    {
      id: "GV-01",
      description: "CORE batch on Ghostnet; policy_hash and evidence_digest derived from committed sources",
      evidenceId: "GV-01",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_A,
        config_version: "1",
        publication_group: "CORE",
        round: "1",
        valid_from: "1786680000",
        valid_until: "1786680180",
        assets: coreAssets(
          { btc: "65000000000", usdt: "1000100", xtz: "750000" },
          { btc: "1786679900", usdt: "1786679920", xtz: "1786679850" },
        ),
      }),
    },
    {
      id: "GV-02",
      description: "USDTZ single-asset batch",
      evidenceId: "GV-02",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_A,
        config_version: "1",
        publication_group: "USDTZ",
        round: "1",
        valid_from: "1786680000",
        valid_until: "1786680180",
        assets: [{ asset_id: "USDTZ_USD", price: "1000000", decimals: "6", observation_time: "1786679900" }],
      }),
    },
    {
      id: "GV-03",
      description: "TZBTC single-asset batch",
      evidenceId: "GV-03",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_A,
        config_version: "1",
        publication_group: "TZBTC",
        round: "1",
        valid_from: "1786680000",
        valid_until: "1786680180",
        assets: [{ asset_id: "TZBTC_USD", price: "65000000000", decimals: "6", observation_time: "1786679900" }],
      }),
    },
    {
      id: "GV-04",
      description: "Same CORE economics as GV-01 on mainnet chain_id (domain separation)",
      evidenceId: "GV-01",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: MAINNET,
        oracle_address: ORACLE_A,
        config_version: "1",
        publication_group: "CORE",
        round: "1",
        valid_from: "1786680000",
        valid_until: "1786680180",
        assets: coreAssets(
          { btc: "65000000000", usdt: "1000100", xtz: "750000" },
          { btc: "1786679900", usdt: "1786679920", xtz: "1786679850" },
        ),
      }),
    },
    {
      id: "GV-05",
      description: "Same CORE economics as GV-01 against a different oracle address",
      evidenceId: "GV-01",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_B,
        config_version: "1",
        publication_group: "CORE",
        round: "1",
        valid_from: "1786680000",
        valid_until: "1786680180",
        assets: coreAssets(
          { btc: "65000000000", usdt: "1000100", xtz: "750000" },
          { btc: "1786679900", usdt: "1786679920", xtz: "1786679850" },
        ),
      }),
    },
    {
      id: "GV-06",
      description: "Skipped round after an outage (round 9); config_version 2 packing fixture with the committed register policy_hash",
      evidenceId: "GV-06",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_A,
        config_version: "2",
        publication_group: "CORE",
        round: "9",
        valid_from: "1786681000",
        valid_until: "1786681180",
        assets: coreAssets(
          { btc: "64900000000", usdt: "999900", xtz: "740000" },
          { btc: "1786680900", usdt: "1786680910", xtz: "1786680890" },
        ),
      }),
    },
    {
      id: "GV-07",
      description: "Timestamp boundary: observation_time = 1, one-second validity window",
      evidenceId: "GV-07",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_A,
        config_version: "1",
        publication_group: "USDTZ",
        round: "2",
        valid_from: "2",
        valid_until: "3",
        assets: [{ asset_id: "USDTZ_USD", price: "900000", decimals: "6", observation_time: "1" }],
      }),
    },
    {
      id: "GV-08",
      description: "CORE decimal/price bounds: minimum register prices",
      evidenceId: "GV-08",
      payload: withPolicy({
        domain: "TEZORACLE_V1",
        chain_id: GHOSTNET,
        oracle_address: ORACLE_A,
        config_version: "1",
        publication_group: "CORE",
        round: "3",
        valid_from: "1786680000",
        valid_until: "1786680180",
        assets: coreAssets(
          { btc: "1000000000", usdt: "900000", xtz: "10000" },
          { btc: "1786679900", usdt: "1786679900", xtz: "1786679900" },
        ),
      }),
    },
  ];
}

async function main(): Promise<void> {
  mkdirSync(vectorsDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(keysDir, { recursive: true });

  const { snapshot, policyHash } = loadCommittedRegister();
  writeFileSync(join(vectorsDir, "michelson_type.json"), `${JSON.stringify(PAYLOAD_MICHELSON_TYPE, null, 2)}\n`);

  const signer = await InMemorySigner.fromSecretKey(TEST_SECRET);
  const publicKey = await signer.publicKey();
  const publicKeyHash = await signer.publicKeyHash();
  const signatures: Record<string, { sig: string; edsig: string; sbytes: string }> = {};
  const evidenceById = new Map<string, ReturnType<typeof buildSharedManifest>>();

  for (const spec of specs(policyHash)) {
    let manifest = evidenceById.get(spec.evidenceId);
    if (!manifest) {
      const draft = { ...spec.payload, evidence_digest: PLACEHOLDER_HASH };
      manifest = buildSharedManifest(draft, snapshot);
      evidenceById.set(spec.evidenceId, manifest);
      writeFileSync(join(evidenceDir, `${spec.evidenceId}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    const payload = { ...spec.payload, evidence_digest: hashSharedManifest(manifest) };
    const packed = packPayload(payload);
    const signed = await signer.sign(packed.packedHex);
    signatures[spec.id] = {
      sig: signed.sig,
      edsig: signed.prefixSig,
      sbytes: signed.sbytes,
    };
    writeFileSync(
      join(vectorsDir, `${spec.id}.json`),
      `${JSON.stringify(
        {
          id: spec.id,
          description: spec.description,
          evidence_id: spec.evidenceId,
          payload,
          micheline: packed.micheline,
          packed_hex: packed.packedHex,
          blake2b_hex: packed.blake2bHex,
        },
        null,
        2,
      )}\n`,
    );
    console.log(spec.id, packed.packedHex.slice(0, 10) + "...", packed.blake2bHex);
  }

  writeFileSync(
    join(evidenceDir, "GV-01.signer-local.json"),
    `${JSON.stringify(
      {
        domain: "TEZORACLE_SIGNER_EVIDENCE_V1",
        payload_hash: "00".repeat(32),
        signer_id: "test-signer-a1",
        validator_class: "A",
        config_version: 1,
        policy_hash: policyHash,
        software_artifact_hash: "11".repeat(32),
        local_price_by_asset: { BTC_USD: "65000000000", USDT_USD: "1000100", XTZ_USD: "750000" },
        local_observation_time_by_asset: { BTC_USD: 1786679900, USDT_USD: 1786679920, XTZ_USD: 1786679850 },
        candidate_deviation_bps_by_asset: { BTC_USD: 0, USDT_USD: 0, XTZ_USD: 0 },
        local_sources: [],
        decision: "sign",
        error_code: null,
        decided_at: 1786680000,
      },
      null,
      2,
    )}\n`,
  );

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
