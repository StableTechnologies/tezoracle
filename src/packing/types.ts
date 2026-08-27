/**
 * Canonical TezOracle payload types. Field order matches docs/PAYLOAD_SPEC.md.
 *
 * publication_group and asset_id are strings taken from the versioned
 * parameter register. The Michelson type stays string; the allowed values
 * are not a closed CORE/USDTZ/TZBTC enumeration in this packer.
 */

export const DOMAIN = "TEZORACLE_V1" as const;

export const PACKING_STATUS = "frozen" as const;

export type PublicationGroup = string;

export const PRICE_NAT_MAX = (1n << 96n) - 1n;

export const PAYLOAD_KEYS = [
  "domain",
  "chain_id",
  "oracle_address",
  "config_version",
  "policy_hash",
  "publication_group",
  "round",
  "valid_from",
  "valid_until",
  "evidence_digest",
  "assets",
] as const;

export const ASSET_KEYS = ["asset_id", "price", "decimals", "observation_time"] as const;

export type AssetEntry = {
  asset_id: string;
  price: string;
  decimals: string;
  observation_time: string;
};

export type LogicalPayload = {
  domain: typeof DOMAIN;
  chain_id: string;
  oracle_address: string;
  config_version: string;
  policy_hash: string;
  publication_group: string;
  round: string;
  valid_from: string;
  valid_until: string;
  evidence_digest: string;
  assets: AssetEntry[];
};

/** Payload fields required to PACK, including values the canonical parser would reject. */
export type PackablePayload = {
  domain: string;
  chain_id: string;
  oracle_address: string;
  config_version: string;
  policy_hash: string;
  publication_group: string;
  round: string;
  valid_from: string;
  valid_until: string;
  evidence_digest: string;
  assets: AssetEntry[];
};

export type PackErrorCode =
  | "DOMAIN"
  | "CHAIN"
  | "ORACLE"
  | "CONFIG"
  | "POLICY"
  | "GROUP"
  | "ROUND"
  | "WINDOW"
  | "EVIDENCE"
  | "ASSETS_SET"
  | "ASSET_ID"
  | "DECIMALS"
  | "PRICE"
  | "OBS_ZERO"
  | "PACK";

export class PackError extends Error {
  readonly code: PackErrorCode;

  constructor(code: PackErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "PackError";
    this.code = code;
  }
}

export type Micheline =
  | { string: string }
  | { int: string }
  | { bytes: string }
  | { prim: string; args?: Micheline[]; annots?: string[] }
  | Micheline[];
