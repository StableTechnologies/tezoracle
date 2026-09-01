import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deriveAssetFromObservations, derivePublicationGroup } from "../../src/validator/derive.js";
import { createMockPoolRpcClient } from "../../src/validator/adapters/dex/rpc.js";
import { loadPoolSampleState, recordSample, savePoolSampleState } from "../../src/validator/adapters/dex/state.js";
import { ValidatorError } from "../../src/validator/errors.js";
import type { SourceAttempt } from "../../src/validator/observe.js";
import type { SourceObservation } from "../../src/validator/types.js";
import { CONFIG_DIR, NOW, coreMockTransport, coreMockTransportWithoutHost, pinnedRegister } from "./helpers.js";
import { loadSnapshot } from "../../src/config/validate.js";

const QUIPUSWAP_V1_POOL = "KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb";
const DEXTER_POOL = "KT1Tr2eG3eVmPRbymrbU2UppUmKjFPXomGG9";
const SIRIUS_TZBTC_POOL = "KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5";
const QUIPUSWAP_TZBTC_POOL = "KT1WBLrLE2vG8SedBqiSJFm4VVAZZBytJYHc";

function usdtzPoolRpc() {
  // Synthetic reserves (ratio ~1.333 XTZ per USDtz) consistent with the CEX
  // fixture's XTZ_USD (~0.7502): 1.333 * 0.7502 ~= 1.0 USD per USDtz.
  return createMockPoolRpcClient({
    storage: {
      [QUIPUSWAP_V1_POOL]: {
        tez_pool: "133300000000",
        token_pool: "100000000000",
        token_address: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
      },
      [DEXTER_POOL]: {
        xtzPool: "13330000000",
        tokenPool: "10000000000",
        tokenAddress: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
      },
    },
  });
}

function tzbtcPoolRpc() {
  // Synthetic reserves (ratio 86,633 XTZ per tzBTC, tzBTC at 8 decimals)
  // consistent with the CEX fixture's XTZ_USD (~0.7502): 86633 * 0.7502 ~= 65000 USD/tzBTC.
  return createMockPoolRpcClient({
    storage: {
      [SIRIUS_TZBTC_POOL]: {
        xtzPool: "86633000000",
        tokenPool: "100000000",
        tokenAddress: "KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn",
      },
      [QUIPUSWAP_TZBTC_POOL]: {
        tez_pool: "43316500000",
        token_pool: "50000000",
        token_address: "KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn",
      },
    },
  });
}

function observation(sourceId: string, price: string, time: number): SourceObservation {
  return {
    source_id: sourceId,
    venue: sourceId,
    independence_group: sourceId,
    market_id: "M",
    endpoint: "https://example.test/p",
    query: "",
    base_asset: "X",
    quote_asset: "USD",
    unit: "USD",
    venue_observation_time: time,
    raw_price: price,
    raw_decimals: 6,
    normalized_price: price,
    conversion: null,
  };
}

test("CORE derivation uses all four venues and the frozen medians", async () => {
  const { snapshot, policy_hash } = pinnedRegister();
  const derived = await derivePublicationGroup({
    snapshot,
    group: "CORE",
    transport: coreMockTransport(),
    now: NOW,
    round: "1",
  });
  assert.equal(derived.policy_hash, policy_hash);
  const byId = Object.fromEntries(derived.assets.map((asset) => [asset.asset_id, asset]));
  assert.equal(byId.USDT_USD?.price, 1000100n);
  assert.equal(byId.USDT_USD?.observation_time, 1786679900);
  assert.equal(byId.XTZ_USD?.price, 750200n);
  assert.equal(byId.XTZ_USD?.observation_time, 1786679860);
  assert.equal(byId.BTC_USD?.price, 65005000000n);
  assert.equal(byId.BTC_USD?.observation_time, 1786679830);
  for (const asset of derived.assets) {
    assert.deepEqual(
      asset.sources.map((source) => source.source_id),
      ["binance", "coinbase", "kraken", "okx"],
    );
  }
});

test("loss of one CEX still derives CORE with three venues", async () => {
  const { snapshot } = pinnedRegister();
  const derived = await derivePublicationGroup({
    snapshot,
    group: "CORE",
    transport: coreMockTransportWithoutHost("api.exchange.coinbase.com"),
    now: NOW,
    round: "1",
  });
  for (const asset of derived.assets) {
    assert.equal(asset.sources.length, 3);
    assert.equal(
      asset.excluded.some((item) => item.source_id === "coinbase" && item.code === "TIMEOUT"),
      true,
    );
  }
});

test("USDTZ and TZBTC fail closed without an injected pool RPC", async () => {
  const { snapshot } = pinnedRegister();
  // Both assets' dex policies are approved, but no PoolRpcClient is injected
  // here, so all pools fail INTERNAL and each group fails closed as INSUFFICIENT.
  await assert.rejects(
    () => derivePublicationGroup({ snapshot, group: "USDTZ", transport: coreMockTransport(), now: NOW }),
    (error: unknown) => error instanceof ValidatorError && error.code === "INSUFFICIENT",
  );
  await assert.rejects(
    () => derivePublicationGroup({ snapshot, group: "TZBTC", transport: coreMockTransport(), now: NOW }),
    (error: unknown) => error instanceof ValidatorError && error.code === "INSUFFICIENT",
  );
});

test("USDTZ derives from two independent pool TWAPs once enough samples accumulate", async () => {
  const { snapshot } = pinnedRegister();
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-usdtz-"));
  try {
    const insufficientStatePath = join(dir, "dex-state-insufficient.json");
    // Below min_twap_observations (3) on a fresh state file: fails closed.
    await assert.rejects(
      () =>
        derivePublicationGroup({
          snapshot,
          group: "USDTZ",
          transport: coreMockTransport(),
          now: NOW,
          poolRpc: usdtzPoolRpc(),
          dexStatePath: insufficientStatePath,
        }),
      (error: unknown) => error instanceof ValidatorError && error.code === "INSUFFICIENT",
    );

    // Separate, pre-seeded state file: two older samples plus the one this
    // call fetches satisfies min_twap_observations (3) and the 1800s window.
    const seededStatePath = join(dir, "dex-state-seeded.json");
    let state = loadPoolSampleState(seededStatePath);
    for (const timestamp of [NOW - 1800, NOW - 900]) {
      state = recordSample(
        state,
        { pool_address: QUIPUSWAP_V1_POOL, protocol: "quipuswap_v1_amm", xtz_reserve: 133_300_000_000n, token_reserve: 100_000_000_000n, timestamp },
        1800,
      );
      state = recordSample(
        state,
        { pool_address: DEXTER_POOL, protocol: "dexter_v1_amm", xtz_reserve: 13_330_000_000n, token_reserve: 10_000_000_000n, timestamp },
        1800,
      );
    }
    savePoolSampleState(seededStatePath, state);

    const derived = await derivePublicationGroup({
      snapshot,
      group: "USDTZ",
      transport: coreMockTransport(),
      now: NOW,
      poolRpc: usdtzPoolRpc(),
      dexStatePath: seededStatePath,
    });
    assert.equal(derived.group, "USDTZ");
    const usdtz = derived.assets.find((asset) => asset.asset_id === "USDTZ_USD");
    assert.ok(usdtz);
    assert.equal(usdtz?.sources.length, 2);
    assert.deepEqual(
      usdtz?.sources.map((source) => source.source_id).sort(),
      [DEXTER_POOL, QUIPUSWAP_V1_POOL].sort(),
    );
    assert.ok(usdtz!.price > 0n);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TZBTC derives from two independent pool TWAPs once enough samples accumulate", async () => {
  const { snapshot } = pinnedRegister();
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-tzbtc-"));
  try {
    const insufficientStatePath = join(dir, "dex-state-insufficient.json");
    // Below min_twap_observations (3) on a fresh state file: fails closed.
    await assert.rejects(
      () =>
        derivePublicationGroup({
          snapshot,
          group: "TZBTC",
          transport: coreMockTransport(),
          now: NOW,
          poolRpc: tzbtcPoolRpc(),
          dexStatePath: insufficientStatePath,
        }),
      (error: unknown) => error instanceof ValidatorError && error.code === "INSUFFICIENT",
    );

    // Separate, pre-seeded state file: two older samples plus the one this
    // call fetches satisfies min_twap_observations (3) and the 1800s window.
    const seededStatePath = join(dir, "dex-state-seeded.json");
    let state = loadPoolSampleState(seededStatePath);
    for (const timestamp of [NOW - 1800, NOW - 900]) {
      state = recordSample(
        state,
        { pool_address: SIRIUS_TZBTC_POOL, protocol: "dexter_v1_amm", xtz_reserve: 86_633_000_000n, token_reserve: 100_000_000n, timestamp },
        1800,
      );
      state = recordSample(
        state,
        { pool_address: QUIPUSWAP_TZBTC_POOL, protocol: "quipuswap_v1_amm", xtz_reserve: 43_316_500_000n, token_reserve: 50_000_000n, timestamp },
        1800,
      );
    }
    savePoolSampleState(seededStatePath, state);

    const derived = await derivePublicationGroup({
      snapshot,
      group: "TZBTC",
      transport: coreMockTransport(),
      now: NOW,
      poolRpc: tzbtcPoolRpc(),
      dexStatePath: seededStatePath,
    });
    assert.equal(derived.group, "TZBTC");
    const tzbtc = derived.assets.find((asset) => asset.asset_id === "TZBTC_USD");
    assert.ok(tzbtc);
    assert.equal(tzbtc?.sources.length, 2);
    assert.deepEqual(
      tzbtc?.sources.map((source) => source.source_id).sort(),
      [QUIPUSWAP_TZBTC_POOL, SIRIUS_TZBTC_POOL].sort(),
    );
    assert.ok(tzbtc!.price > 0n);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("three healthy venues derive; two fail closed", () => {
  const { snapshot } = loadSnapshot(CONFIG_DIR);
  const usdt = snapshot.assets.USDT_USD!;
  const three: SourceAttempt[] = ["binance", "okx", "kraken"].map((id) => ({
    ok: true as const,
    observation: observation(id, "1000100", NOW - 10),
  }));
  const derived = deriveAssetFromObservations(usdt, three);
  assert.equal(derived.ok, true);
  if (derived.ok) {
    assert.equal(derived.asset.price, 1000100n);
    assert.deepEqual(
      derived.asset.sources.map((source) => source.source_id),
      ["binance", "kraken", "okx"],
    );
  }

  const two: SourceAttempt[] = ["binance", "okx"].map((id) => ({
    ok: true as const,
    observation: observation(id, "1000100", NOW - 10),
  }));
  const short = deriveAssetFromObservations(usdt, two);
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.code, "INSUFFICIENT");
});

test("outlier exclusion succeeds only when three venues remain", () => {
  const { snapshot } = loadSnapshot(CONFIG_DIR);
  const usdt = snapshot.assets.USDT_USD!;
  const fourWithOutlier: SourceAttempt[] = [
    { ok: true, observation: observation("binance", "1000100", NOW - 10) },
    { ok: true, observation: observation("okx", "1000100", NOW - 10) },
    { ok: true, observation: observation("kraken", "1000100", NOW - 10) },
    { ok: true, observation: observation("coinbase", "2000000", NOW - 10) },
  ];
  const dropped = deriveAssetFromObservations(usdt, fourWithOutlier);
  assert.equal(dropped.ok, true);
  if (dropped.ok) {
    assert.equal(dropped.asset.excluded.some((item) => item.code === "OUTLIER"), true);
    assert.equal(dropped.asset.sources.some((item) => item.source_id === "coinbase"), false);
    assert.equal(dropped.asset.sources.length, 3);
  }

  const threeWithOutlier: SourceAttempt[] = [
    { ok: true, observation: observation("binance", "1000100", NOW - 10) },
    { ok: true, observation: observation("okx", "1000100", NOW - 10) },
    { ok: true, observation: observation("kraken", "2000000", NOW - 10) },
  ];
  const insufficient = deriveAssetFromObservations(usdt, threeWithOutlier);
  assert.equal(insufficient.ok, false);
  if (!insufficient.ok) assert.equal(insufficient.code, "INSUFFICIENT");
});

test("set divergence and bounds fail closed", () => {
  const { snapshot } = loadSnapshot(CONFIG_DIR);
  const usdt = { ...snapshot.assets.USDT_USD!, max_set_deviation_bps: 1 };
  const spread: SourceAttempt[] = [
    { ok: true, observation: observation("binance", "1000000", NOW - 10) },
    { ok: true, observation: observation("okx", "1000100", NOW - 10) },
    { ok: true, observation: observation("kraken", "1000200", NOW - 10) },
    { ok: true, observation: observation("coinbase", "1000300", NOW - 10) },
  ];
  const diverged = deriveAssetFromObservations(usdt, spread);
  assert.equal(diverged.ok, false);
  if (!diverged.ok) assert.equal(diverged.code, "SET_DIVERGENCE");

  const outOfBounds = deriveAssetFromObservations(
    { ...snapshot.assets.USDT_USD!, absolute_max_price: "1000000" },
    [
      { ok: true, observation: observation("binance", "1000100", NOW - 10) },
      { ok: true, observation: observation("okx", "1000100", NOW - 10) },
      { ok: true, observation: observation("kraken", "1000100", NOW - 10) },
      { ok: true, observation: observation("coinbase", "1000100", NOW - 10) },
    ],
  );
  assert.equal(outOfBounds.ok, false);
  if (!outOfBounds.ok) assert.equal(outOfBounds.code, "BOUNDS");
});
