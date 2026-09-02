/**
 * Pure TWAP math shared by DEX pool adapters. No network/state here.
 *
 * Constant-product pools (Quipuswap v1, Dexter, and the native Liquidity
 * Baking CPMM) publish no price oracle, so the validator samples raw
 * reserves itself over time and builds a linear, duration-weighted average
 * locally:
 *
 *   spot_i  = xtz_reserve_i / token_reserve_i   (XTZ per token, decimal-adjusted)
 *   TWAP    = Σ(spot_i * duration_i) / Σ(duration_i)
 *
 * where duration_i is the gap to the next sample (step-function / left
 * Riemann sum). All arithmetic is bigint fixed-point via decimal.ts helpers
 * -- no floating point, matching the rest of the derivation pipeline.
 */
import { divScale } from "../../decimal.js";
import { ValidatorError } from "../../errors.js";
import type { PoolSpotSample } from "./types.js";

export type LinearTwapResult = {
  /** XTZ per token, scaled to `outputDecimals`. */
  price: bigint;
  elapsed_seconds: number;
  observation_count: number;
};

/**
 * One pool's spot price (XTZ per token) at `outputDecimals` fixed-point.
 *
 * `xtz_reserve` is raw mutez (6 decimals, native). `token_reserve` is the
 * pool's other leg at its own `tokenDecimals` (e.g. 8 for tzBTC, 6 for
 * USDtz) -- these must be decimal-adjusted to a common scale before
 * dividing, or the result is silently off by 10^|tokenDecimals - 6|.
 */
export function spotPrice(sample: PoolSpotSample, tokenDecimals: number, outputDecimals: number): bigint {
  const XTZ_DECIMALS = 6;
  const exponent = tokenDecimals + outputDecimals - XTZ_DECIMALS;
  if (exponent < 0) {
    throw new ValidatorError("INTERNAL", `unsupported decimals combination (token=${tokenDecimals}, output=${outputDecimals})`);
  }
  return divScale(sample.xtz_reserve, sample.token_reserve, exponent);
}

export function computeLinearTwap(
  samplesAsc: readonly PoolSpotSample[],
  args: { tokenDecimals: number; outputDecimals: number; minObservations: number; minWindowSeconds: number },
): LinearTwapResult {
  if (samplesAsc.length < args.minObservations) {
    throw new ValidatorError(
      "DEX_TWAP",
      `${samplesAsc.length} samples < min_twap_observations ${args.minObservations}`,
    );
  }
  const poolAddress = samplesAsc[0]!.pool_address;
  for (let i = 1; i < samplesAsc.length; i++) {
    const prev = samplesAsc[i - 1]!;
    const curr = samplesAsc[i]!;
    if (curr.pool_address !== poolAddress) {
      throw new ValidatorError("INTERNAL", "TWAP samples are from different pools");
    }
    if (curr.timestamp <= prev.timestamp) {
      throw new ValidatorError("INTERNAL", "TWAP samples are not strictly increasing in time");
    }
  }
  const first = samplesAsc[0]!;
  const last = samplesAsc[samplesAsc.length - 1]!;
  const elapsed = last.timestamp - first.timestamp;
  if (elapsed < args.minWindowSeconds) {
    throw new ValidatorError("DEX_TWAP", `elapsed window ${elapsed}s is below the minimum ${args.minWindowSeconds}s`);
  }

  let weightedSum = 0n;
  for (let i = 0; i < samplesAsc.length - 1; i++) {
    const curr = samplesAsc[i]!;
    const next = samplesAsc[i + 1]!;
    const duration = BigInt(next.timestamp - curr.timestamp);
    weightedSum += spotPrice(curr, args.tokenDecimals, args.outputDecimals) * duration;
  }
  const price = divScale(weightedSum, BigInt(elapsed), 0);
  return { price, elapsed_seconds: elapsed, observation_count: samplesAsc.length };
}


