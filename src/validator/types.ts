import type { LogicalPayload, PublicationGroup } from "../packing/types.js";
import type { RefusalCode } from "./errors.js";

export const EVIDENCE_DOMAIN = "TEZORACLE_EVIDENCE_V1" as const;
export const SIGNER_EVIDENCE_DOMAIN = "TEZORACLE_SIGNER_EVIDENCE_V1" as const;
export const VALIDATOR_CLASS = "A" as const;

export type ConversionLeg = {
  via_asset_id: "USDT_USD" | "XTZ_USD";
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
  aggregation: "median_lower";
  rounding_mode: "half_away_from_zero";
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
  publication_group: PublicationGroup;
  round: string;
  assets: AssetEvidence[];
};

export type SignerLocalRecord = {
  domain: typeof SIGNER_EVIDENCE_DOMAIN;
  payload_hash: string;
  signer_id: string;
  validator_class: typeof VALIDATOR_CLASS;
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

export type UsdtFactor = {
  price: bigint;
  decimals: number;
  observation_time: number;
};

export type DerivedAsset = {
  asset_id: string;
  price: bigint;
  decimals: number;
  observation_time: number;
  min_independent_observations: number;
  sources: SourceObservation[];
  excluded: ExcludedSource[];
};

export type GroupDerivation = {
  group: PublicationGroup;
  policy_hash: string;
  config_version: number;
  assets: DerivedAsset[];
  evidence: SharedEvidenceManifest;
  evidence_digest: string;
};

export type CandidateDocument = {
  payload: LogicalPayload;
  evidence: SharedEvidenceManifest;
};

export type VerificationSuccess = {
  ok: true;
  payload: LogicalPayload;
  evidence: SharedEvidenceManifest;
  evidence_digest: string;
  local: GroupDerivation;
  deviation_bps_by_asset: Record<string, number>;
};

export type VerificationFailure = {
  ok: false;
  code: RefusalCode;
  detail: string;
  local?: GroupDerivation;
};

export type VerificationResult = VerificationSuccess | VerificationFailure;

export type SignedPayload = {
  payload: LogicalPayload;
  packed_hex: string;
  blake2b_hex: string;
  signature: {
    sig: string;
    edsig: string;
    sbytes: string;
  };
  public_key: string;
  public_key_hash: string;
  local_record: SignerLocalRecord;
};
