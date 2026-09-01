import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { candidateFromDerivation, verifyCandidate } from "../../src/validator/candidate.js";
import { createMockPoolRpcClient } from "../../src/validator/adapters/dex/rpc.js";
import { loadPoolSampleState, recordSample, savePoolSampleState } from "../../src/validator/adapters/dex/state.js";
import { derivePublicationGroup } from "../../src/validator/derive.js";
import { evidenceDigestHex } from "../../src/validator/evidence.js";
import { NOW, coreMockTransport, pinnedRegister } from "./helpers.js";
import { clone } from "./helpers.js";

const SHADOWNET = "NetXsqzbfFenSTS";
const ORACLE = "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy";
const QUIPUSWAP_V1_POOL = "KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb";
const DEXTER_POOL = "KT1Tr2eG3eVmPRbymrbU2UppUmKjFPXomGG9";

async function matchingCandidate() {
  const { snapshot } = pinnedRegister();
  const derivation = await derivePublicationGroup({
    snapshot,
    group: "CORE",
    transport: coreMockTransport(),
    now: NOW,
    round: "1",
  });
  const document = candidateFromDerivation({
    derivation,
    chain_id: SHADOWNET,
    oracle_address: ORACLE,
    round: "1",
    valid_from: String(NOW),
    valid_until: String(NOW + snapshot.register.time_policy.validity_window_seconds),
  });
  return { snapshot, document };
}

test("a self-derived USDTZ candidate (XTZ-bridged DEX sources) verifies under the pinned policy", async () => {
  // Regression: verifyCandidate's canonical re-parse of the candidate JSON
  // used to hard-reject any conversion.via_asset_id other than "USDT_USD",
  // which made every USDTZ/TZBTC candidate (bridged via XTZ_USD) fail
  // EVIDENCE_SOURCE on sign/verify even though derive() itself succeeded.
  const { snapshot } = pinnedRegister();
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-candidate-usdtz-"));
  try {
    const statePath = join(dir, "dex-state.json");
    let state = loadPoolSampleState(statePath);
    for (const timestamp of [NOW - 1800, NOW - 900]) {
      state = recordSample(
        state,
        { pool_address: QUIPUSWAP_V1_POOL, protocol: "quipuswap_v1_amm", xtz_reserve: 133_300_000_000n, token_reserve: 100_000_000_000n, timestamp },
        3600,
      );
      state = recordSample(
        state,
        { pool_address: DEXTER_POOL, protocol: "dexter_v1_amm", xtz_reserve: 13_330_000_000n, token_reserve: 10_000_000_000n, timestamp },
        3600,
      );
    }
    savePoolSampleState(statePath, state);
    const poolRpc = createMockPoolRpcClient({
      storage: {
        [QUIPUSWAP_V1_POOL]: {
          storage: {
            tez_pool: "133300000000",
            token_pool: "100000000000",
            token_address: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
          },
        },
        [DEXTER_POOL]: {
          xtzPool: "13330000000",
          tokenPool: "10000000000",
          tokenAddress: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
        },
      },
    });
    const derivation = await derivePublicationGroup({
      snapshot,
      group: "USDTZ",
      transport: coreMockTransport(),
      now: NOW,
      round: "1",
      poolRpc,
      dexStatePath: statePath,
    });
    const document = candidateFromDerivation({
      derivation,
      chain_id: SHADOWNET,
      oracle_address: ORACLE,
      round: "1",
      valid_from: String(NOW),
      valid_until: String(NOW + snapshot.register.time_policy.validity_window_seconds),
    });
    const result = await verifyCandidate({
      snapshot,
      candidate: document,
      transport: coreMockTransport(),
      now: NOW,
      poolRpc,
      dexStatePath: statePath,
    });
    assert.equal(result.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a self-derived CORE candidate verifies under the pinned policy", async () => {
  const { snapshot, document } = await matchingCandidate();
  const result = await verifyCandidate({
    snapshot,
    candidate: document,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.deviation_bps_by_asset.XTZ_USD, 0);
    assert.equal(result.payload.assets[2]?.price, "750200");
  }
});

test("unknown policy-shaped fields are refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const result = await verifyCandidate({
    snapshot,
    candidate: { ...document, max_signer_deviation_bps: 10_000 },
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "POLICY_PIN");
});

test("altered candidate price is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  mutated.payload.assets[2] = { ...mutated.payload.assets[2]!, price: "760000" };
  mutated.evidence.assets[2] = { ...mutated.evidence.assets[2]!, price: "760000" };
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_LOCAL");
});

test("altered policy hash is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  mutated.payload.policy_hash = "aa".repeat(32);
  mutated.evidence.policy_hash = mutated.payload.policy_hash;
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "POLICY_PIN");
});

test("altered source endpoint is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  const source = mutated.evidence.assets[2]?.sources[0];
  assert.ok(source);
  source.endpoint = "https://evil.example/xtz";
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_ENDPOINT");
});

test("altered observation timestamp is refused when newer than local", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  const newer = NOW - 1;
  mutated.payload.assets[2] = { ...mutated.payload.assets[2]!, observation_time: String(newer) };
  mutated.evidence.assets[2] = {
    ...mutated.evidence.assets[2]!,
    observation_time: newer,
    calculation: { ...mutated.evidence.assets[2]!.calculation, oldest_observation_time: newer },
    sources: mutated.evidence.assets[2]!.sources.map((source) => ({
      ...source,
      venue_observation_time: newer,
      conversion: source.conversion ? { ...source.conversion, factor_observation_time: newer } : null,
    })),
  };
  mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_TIME");
});

test("altered evidence digest is refused", async () => {
  const { snapshot, document } = await matchingCandidate();
  const mutated = clone(document);
  mutated.payload.evidence_digest = "bb".repeat(32);
  const result = await verifyCandidate({
    snapshot,
    candidate: mutated,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EVIDENCE_DIGEST");
});
