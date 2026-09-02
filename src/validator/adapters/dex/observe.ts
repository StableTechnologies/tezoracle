import type { AssetConfig, DexConfig, DexPool } from "../../../config/validate.js";
import { PRICE_NAT_MAX } from "../../../packing/types.js";
import { assertPositivePrice, mulScale } from "../../decimal.js";
import { ValidatorError } from "../../errors.js";
import type { SourceAttempt } from "../../observe.js";
import type { SourceObservation, UsdtFactor } from "../../types.js";
import { fetchConstantProductSample } from "./constant_product.js";
import type { PoolRpcClient } from "./rpc.js";
import { recordSample, sampleSeries, type PoolSampleStore } from "./state.js";
import { computeLinearTwap } from "./twap.js";

function excluded(pool: DexPool, code: string, detail: string): SourceAttempt {
  return { ok: false, excluded: { source_id: pool.pool_address, code, detail } };
}

/** e.g. "USDTZ_USD" -> "USDTZ", "TZBTC_USD" -> "TZBTC". */
export function baseAssetFromId(assetId: string): string {
  return assetId.replace(/_USD$/, "");
}

export async function observeXtzPairPool(args: {
  pool: DexPool;
  asset: AssetConfig;
  dex: DexConfig;
  rpc: PoolRpcClient;
  store: PoolSampleStore | undefined;
  now: number;
  xtzUsd: UsdtFactor;
}): Promise<SourceAttempt> {
  const { pool, asset, dex, rpc, store, now, xtzUsd } = args;
  if (dex.twap_window_seconds === null || dex.min_twap_observations === null || dex.min_liquidity === null) {
    return excluded(pool, "INTERNAL", "dex policy is not fully specified");
  }

  const fetched = await fetchConstantProductSample(pool, rpc, now);
  if (!fetched.ok) {
    return { ok: false, excluded: { source_id: pool.pool_address, code: fetched.code, detail: fetched.detail } };
  }
  const sample = fetched.sample;
  if (sample.token_reserve < BigInt(dex.min_liquidity)) {
    return excluded(pool, "DEX_LIQUIDITY", `token reserve ${sample.token_reserve} < min_liquidity ${dex.min_liquidity}`);
  }

  let state = store ? await store.load() : {};
  // Retain well beyond the TWAP window itself -- pruning at exactly
  // twap_window_seconds would make the elapsed-window check below nearly
  // unwinnable (see recordSample's doc comment).
  state = recordSample(state, sample, dex.twap_window_seconds * 2);
  if (store) await store.save(state);

  let twap;
  try {
    twap = computeLinearTwap(sampleSeries(state, pool), {
      tokenDecimals: pool.token_a_decimals,
      outputDecimals: asset.decimals,
      minObservations: dex.min_twap_observations,
      minWindowSeconds: dex.twap_window_seconds,
    });
  } catch (error) {
    if (error instanceof ValidatorError) return excluded(pool, error.code, error.message);
    return excluded(pool, "INTERNAL", "TWAP computation failed");
  }

  if (xtzUsd.decimals !== asset.decimals) {
    return excluded(pool, "BAD_NUMBER", "XTZ_USD factor decimals must match the asset");
  }
  let normalized: bigint;
  try {
    normalized = assertPositivePrice(mulScale(twap.price, xtzUsd.price, asset.decimals), "XTZ-adjusted price");
  } catch (error) {
    if (error instanceof ValidatorError) return excluded(pool, error.code, error.message);
    return excluded(pool, "BAD_NUMBER", "XTZ conversion failed");
  }
  if (normalized > PRICE_NAT_MAX) {
    return excluded(pool, "BAD_NUMBER", "XTZ-adjusted price exceeds price_nat_max");
  }

  const observation: SourceObservation = {
    source_id: pool.pool_address,
    venue: pool.protocol,
    independence_group: pool.pool_address,
    market_id: `${pool.token_a_address}/XTZ`,
    endpoint: "",
    query: "",
    base_asset: baseAssetFromId(asset.asset_id),
    quote_asset: "XTZ",
    unit: "XTZ",
    venue_observation_time: now,
    raw_price: twap.price.toString(),
    raw_decimals: asset.decimals,
    normalized_price: normalized.toString(),
    conversion: {
      via_asset_id: "XTZ_USD",
      factor: xtzUsd.price.toString(),
      factor_decimals: xtzUsd.decimals,
      factor_observation_time: xtzUsd.observation_time,
    },
  };
  return { ok: true, observation };
}
