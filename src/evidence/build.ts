import type { RegisterSnapshot, SourceConfig } from "../config/validate.js";
import type { LogicalPayload } from "../packing/types.js";
import type { AssetEvidence, SharedEvidenceManifest, SourceObservation } from "./types.js";
import { EVIDENCE_DOMAIN } from "./types.js";

function contributingSources(assetId: string, snapshot: RegisterSnapshot): SourceConfig[] {
  const asset = snapshot.assets[assetId];
  if (!asset) return [];
  return asset.sources
    .filter((source) => source.adapter_status === "initial_phase")
    .sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0));
}

function observationFor(
  source: SourceConfig,
  payload: LogicalPayload,
  assetId: string,
  venueTime: number,
): SourceObservation {
  const payloadAsset = payload.assets.find((asset) => asset.asset_id === assetId);
  const usdt = payload.assets.find((asset) => asset.asset_id === "USDT_USD");
  const conversion =
    source.quote_conversion === "usdt_usd" && usdt
      ? {
          via_asset_id: "USDT_USD",
          factor: usdt.price,
          factor_decimals: Number(usdt.decimals),
          factor_observation_time: Number(usdt.observation_time),
        }
      : null;
  return {
    source_id: source.source_id,
    venue: source.venue,
    independence_group: source.independence_group,
    market_id: source.market_id,
    endpoint: source.endpoint,
    query: source.query,
    base_asset: source.base_asset,
    quote_asset: source.quote_asset,
    unit: source.quote_asset,
    venue_observation_time: venueTime,
    raw_price: payloadAsset?.price ?? "1",
    raw_decimals: Number(payloadAsset?.decimals ?? "6"),
    normalized_price: payloadAsset?.price ?? "1",
    conversion,
  };
}

function assetEvidence(payload: LogicalPayload, snapshot: RegisterSnapshot, assetId: string): AssetEvidence {
  const payloadAsset = payload.assets.find((asset) => asset.asset_id === assetId);
  if (!payloadAsset) {
    throw new Error(`payload missing ${assetId}`);
  }
  const asset = snapshot.assets[assetId];
  if (!asset) throw new Error(`register missing ${assetId}`);
  const venueTime = Number(payloadAsset.observation_time);
  const sources = contributingSources(assetId, snapshot).map((source) =>
    observationFor(source, payload, assetId, venueTime),
  );
  const excluded =
    sources.length === 0 && asset.derivation !== "cex_median"
      ? [{ source_id: "dex_pools", code: "DEX_TWAP", detail: "pools pending_review" }]
      : [];
  return {
    asset_id: assetId,
    price: payloadAsset.price,
    decimals: Number(payloadAsset.decimals),
    observation_time: venueTime,
    calculation: {
      aggregation: asset.aggregation,
      rounding_mode: asset.rounding_mode,
      min_independent_observations: asset.min_independent_observations,
      contributing_source_ids: sources.map((source) => source.source_id),
      oldest_observation_time: venueTime,
    },
    sources,
    excluded,
  };
}

export function buildSharedManifest(payload: LogicalPayload, snapshot: RegisterSnapshot): SharedEvidenceManifest {
  return {
    domain: EVIDENCE_DOMAIN,
    policy_hash: payload.policy_hash,
    publication_group: payload.publication_group,
    round: payload.round,
    assets: payload.assets.map((asset) => assetEvidence(payload, snapshot, asset.asset_id)),
  };
}
