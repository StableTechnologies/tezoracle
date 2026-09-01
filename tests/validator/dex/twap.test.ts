import assert from "node:assert/strict";
import test from "node:test";

import { ValidatorError } from "../../../src/validator/errors.js";
import { computeLinearTwap, spotPrice } from "../../../src/validator/adapters/dex/twap.js";
import type { PoolSpotSample } from "../../../src/validator/adapters/dex/types.js";

function sample(overrides: Partial<PoolSpotSample>): PoolSpotSample {
  return {
    pool_address: "KT1Pool",
    protocol: "dexter_v1_amm",
    xtz_reserve: 1_000_000n,
    token_reserve: 1_000_000n,
    timestamp: 0,
    ...overrides,
  };
}

test("spotPrice is xtz_reserve/token_reserve at the requested decimals", () => {
  // real Quipuswap v1 reserves verified 2026-09-01: 124232.308202 XTZ / 32935.110728 USDtz
  const s = sample({ xtz_reserve: 124_232_308_202n, token_reserve: 32_935_110_728n });
  const price = spotPrice(s, 6);
  // ~3.772032 XTZ per USDtz (rounds half-away-from-zero up to ...033)
  assert.equal(price, 3_772_033n);
});

test("computeLinearTwap recovers a constant price held across the whole window", () => {
  const samples = [
    sample({ xtz_reserve: 2_000_000n, token_reserve: 1_000_000n, timestamp: 0 }),
    sample({ xtz_reserve: 2_000_000n, token_reserve: 1_000_000n, timestamp: 900 }),
    sample({ xtz_reserve: 2_000_000n, token_reserve: 1_000_000n, timestamp: 1800 }),
  ];
  const result = computeLinearTwap(samples, { decimals: 6, minObservations: 3, minWindowSeconds: 1800 });
  assert.equal(result.price, 2_000_000n);
  assert.equal(result.elapsed_seconds, 1800);
  assert.equal(result.observation_count, 3);
});

test("computeLinearTwap weights by the duration held at each price", () => {
  // price=1.0 for 1500s, then price=2.0 for 300s -> weighted avg = (1*1500 + 2*300) / 1800
  const samples = [
    sample({ xtz_reserve: 1_000_000n, token_reserve: 1_000_000n, timestamp: 0 }),
    sample({ xtz_reserve: 2_000_000n, token_reserve: 1_000_000n, timestamp: 1500 }),
    sample({ xtz_reserve: 2_000_000n, token_reserve: 1_000_000n, timestamp: 1800 }),
  ];
  const result = computeLinearTwap(samples, { decimals: 6, minObservations: 3, minWindowSeconds: 1800 });
  // (1_000_000*1500 + 2_000_000*300) / 1800 = 1_166_666.67 -> rounds to 1_166_667
  assert.equal(result.price, 1_166_667n);
});

test("computeLinearTwap fails closed below min_twap_observations", () => {
  const samples = [sample({ timestamp: 0 }), sample({ timestamp: 1800 })];
  assert.throws(
    () => computeLinearTwap(samples, { decimals: 6, minObservations: 3, minWindowSeconds: 60 }),
    (error: unknown) => error instanceof ValidatorError && error.code === "DEX_TWAP",
  );
});

test("computeLinearTwap fails closed below the minimum window", () => {
  const samples = [
    sample({ timestamp: 0 }),
    sample({ timestamp: 10 }),
    sample({ timestamp: 20 }),
  ];
  assert.throws(
    () => computeLinearTwap(samples, { decimals: 6, minObservations: 3, minWindowSeconds: 1800 }),
    (error: unknown) => error instanceof ValidatorError && error.code === "DEX_TWAP",
  );
});

test("computeLinearTwap refuses samples from different pools", () => {
  const samples = [
    sample({ pool_address: "KT1A", timestamp: 0 }),
    sample({ pool_address: "KT1B", timestamp: 900 }),
    sample({ pool_address: "KT1A", timestamp: 1800 }),
  ];
  assert.throws(
    () => computeLinearTwap(samples, { decimals: 6, minObservations: 3, minWindowSeconds: 60 }),
    (error: unknown) => error instanceof ValidatorError && error.code === "INTERNAL",
  );
});
