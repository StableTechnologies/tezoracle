import assert from "node:assert/strict";
import test from "node:test";

import { deriveAssetFromObservations, derivePublicationGroup } from "../../src/validator/derive.js";
import { ValidatorError } from "../../src/validator/errors.js";
import type { SourceAttempt } from "../../src/validator/observe.js";
import type { SourceObservation } from "../../src/validator/types.js";
import { CONFIG_DIR, NOW, coreMockTransport, coreMockTransportWithoutHost, pinnedRegister } from "./helpers.js";
import { loadSnapshot } from "../../src/config/validate.js";

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

test("USDTZ and TZBTC groups are refused as stubs", async () => {
  const { snapshot } = pinnedRegister();
  await assert.rejects(
    () => derivePublicationGroup({ snapshot, group: "USDTZ", transport: coreMockTransport(), now: NOW }),
    (error: unknown) => error instanceof ValidatorError && error.code === "POLICY_PIN",
  );
  await assert.rejects(
    () => derivePublicationGroup({ snapshot, group: "TZBTC", transport: coreMockTransport(), now: NOW }),
    (error: unknown) => error instanceof ValidatorError && error.code === "POLICY_PIN",
  );
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
