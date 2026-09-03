export const CONFIG_DOMAIN = "TEZORACLE_CONFIG_V1" as const;
export const CONFIG_CANCEL_DOMAIN = "TEZORACLE_CONFIG_CANCEL_V1" as const;
export const UNPAUSE_DOMAIN = "TEZORACLE_UNPAUSE_V1" as const;
export const UNPAUSE_CANCEL_DOMAIN = "TEZORACLE_UNPAUSE_CANCEL_V1" as const;
export const ASSET_UNPAUSE_DOMAIN = "TEZORACLE_ASSET_UNPAUSE_V1" as const;
export const ASSET_UNPAUSE_CANCEL_DOMAIN = "TEZORACLE_ASSET_UNPAUSE_CANCEL_V1" as const;

export const SIMPLE_GOVERNANCE_DOMAINS = [
  CONFIG_CANCEL_DOMAIN,
  UNPAUSE_DOMAIN,
  UNPAUSE_CANCEL_DOMAIN,
] as const;

export const ASSET_GOVERNANCE_DOMAINS = [ASSET_UNPAUSE_DOMAIN, ASSET_UNPAUSE_CANCEL_DOMAIN] as const;

export const INIT_KEYS = [
  "admin",
  "guardian",
  "config_version",
  "policy_hash",
  "threshold_n",
  "threshold_m",
  "activation_delay_levels",
  "min_activation_delay_levels",
  "max_clock_skew_seconds",
  "validity_window_seconds",
  "price_nat_max",
  "signers",
  "class_minima",
  "groups",
  "assets",
] as const;

export const SIGNER_KEYS = ["public_key", "class_id", "active"] as const;

export const ASSET_POLICY_KEYS = [
  "decimals",
  "max_observation_age_seconds",
  "absolute_min_price",
  "absolute_max_price",
  "max_movement_bps",
] as const;

export const CONFIG_INTENT_KEYS = [
  "domain",
  "chain_id",
  "oracle_address",
  "current_config_version",
  "governance_nonce",
  "valid_until",
  "init",
] as const;

export const SIMPLE_INTENT_KEYS = [
  "domain",
  "chain_id",
  "oracle_address",
  "current_config_version",
  "governance_nonce",
  "valid_until",
] as const;

export const ASSET_INTENT_KEYS = [...SIMPLE_INTENT_KEYS, "asset_id"] as const;

export type LogicalSigner = {
  public_key: string;
  class_id: string;
  active: boolean;
};

export type LogicalAssetPolicy = {
  decimals: string;
  max_observation_age_seconds: string;
  absolute_min_price: string;
  absolute_max_price: string;
  max_movement_bps: string;
};

export type LogicalInit = {
  admin: string;
  guardian: string;
  config_version: string;
  policy_hash: string;
  threshold_n: string;
  threshold_m: string;
  activation_delay_levels: string;
  min_activation_delay_levels: string;
  max_clock_skew_seconds: string;
  validity_window_seconds: string;
  price_nat_max: string;
  signers: Record<string, LogicalSigner>;
  class_minima: Record<string, string>;
  groups: Record<string, string[]>;
  assets: Record<string, LogicalAssetPolicy>;
};

export type LogicalConfigIntent = {
  domain: typeof CONFIG_DOMAIN;
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
  init: LogicalInit;
};

export type LogicalSimpleIntent = {
  domain: (typeof SIMPLE_GOVERNANCE_DOMAINS)[number];
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
};

export type LogicalAssetIntent = {
  domain: (typeof ASSET_GOVERNANCE_DOMAINS)[number];
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
  asset_id: string;
};
