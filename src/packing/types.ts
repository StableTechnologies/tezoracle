/**
 * Canonical TezOracle payload types. Field order matches docs/PAYLOAD_SPEC.md.
 */

export const DOMAIN = "TEZORACLE_V1" as const;

export const PACKING_STATUS = "frozen" as const;

export type PublicationGroup = "CORE" | "USDTZ" | "TZBTC";

export const GROUP_ASSETS: Record<PublicationGroup, readonly string[]> = {
  CORE: ["BTC_USD", "USDT_USD", "XTZ_USD"],
  USDTZ: ["USDTZ_USD"],
  TZBTC: ["TZBTC_USD"],
};

export const ASSET_DECIMALS: Record<string, number> = {
  BTC_USD: 6,
  USDT_USD: 6,
  XTZ_USD: 6,
  USDTZ_USD: 6,
  TZBTC_USD: 6,
};

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
  publication_group: PublicationGroup;
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
