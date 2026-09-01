import { divScale } from "../../decimal.js";
import { ValidatorError } from "../../errors.js";
import type { PoolSpotSample } from "./types.js";

export type LinearTwapResult = {
  /** XTZ per USDtz, scaled to `decimals`. */
  price: bigint;
  elapsed_seconds: number;
  observation_count: number;
};

/** One pool's spot price at `decimals` fixed-point (XTZ per USDtz). */
export function spotPrice(sample: PoolSpotSample, decimals: number): bigint {
  return divScale(sample.xtz_reserve, sample.token_reserve, decimals);
}

export function computeLinearTwap(
  samplesAsc: readonly PoolSpotSample[],
  args: { decimals: number; minObservations: number; minWindowSeconds: number },
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
    weightedSum += spotPrice(curr, args.decimals) * duration;
  }
  const price = divScale(weightedSum, BigInt(elapsed), 0);
  return { price, elapsed_seconds: elapsed, observation_count: samplesAsc.length };
}

