export const EVIDENCE_DOMAIN = "TEZORACLE_EVIDENCE_V1" as const;
export const SIGNER_LOCAL_DOMAIN = "TEZORACLE_SIGNER_EVIDENCE_V1" as const;

export type ConversionLeg = {
  via_asset_id: string;
  factor: string;
  factor_decimals: number;
  factor_observation_time: number;
};

export type SourceObservation = {
  source_id: string;
  venue: string;
  independence_group: string;
  market_id: string;
  endpoint: string;
  query: string;
  base_asset: string;
  quote_asset: string;
  unit: string;
  venue_observation_time: number;
  raw_price: string;
  raw_decimals: number;
  normalized_price: string;
  conversion: ConversionLeg | null;
};

export type ExcludedSource = {
  source_id: string;
  code: string;
  detail: string;
};

export type AssetCalculation = {
  aggregation: string;
  rounding_mode: string;
  min_independent_observations: number;
  contributing_source_ids: string[];
  oldest_observation_time: number;
};

export type AssetEvidence = {
  asset_id: string;
  price: string;
  decimals: number;
  observation_time: number;
  calculation: AssetCalculation;
  sources: SourceObservation[];
  excluded: ExcludedSource[];
};

export type SharedEvidenceManifest = {
  domain: typeof EVIDENCE_DOMAIN;
  policy_hash: string;
  publication_group: string;
  round: string;
  assets: AssetEvidence[];
};

export type SignerLocalRecord = {
  domain: typeof SIGNER_LOCAL_DOMAIN;
  payload_hash: string;
  signer_id: string;
  validator_class: "A" | "B";
  config_version: number;
  policy_hash: string;
  software_artifact_hash: string;
  local_price_by_asset: Record<string, string>;
  local_observation_time_by_asset: Record<string, number>;
  candidate_deviation_bps_by_asset: Record<string, number>;
  local_sources: SourceObservation[];
  decision: "sign" | "refuse";
  error_code: string | null;
  decided_at: number;
};

export class EvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "EvidenceError";
    this.code = code;
  }
}
