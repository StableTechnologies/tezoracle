import { ValidationResult, validateChain, validateContractAddress } from "@taquito/utils";

import { PackError } from "./types.js";
import {
  ASSET_GOVERNANCE_DOMAINS,
  ASSET_INTENT_KEYS,
  ASSET_POLICY_KEYS,
  CONFIG_DOMAIN,
  CONFIG_INTENT_KEYS,
  INIT_KEYS,
  SIGNER_KEYS,
  SIMPLE_GOVERNANCE_DOMAINS,
  SIMPLE_INTENT_KEYS,
  type LogicalAssetIntent,
  type LogicalAssetPolicy,
  type LogicalConfigIntent,
  type LogicalInit,
  type LogicalSigner,
  type LogicalSimpleIntent,
} from "./governance_types.js";

const NAT_STRING = /^(0|[1-9][0-9]*)$/;
const HEX64 = /^[0-9a-f]{64}$/;

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function missingKeys(value: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((key) => !(key in value));
}

function requireKeys(raw: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = extraKeys(raw, allowed);
  const missing = missingKeys(raw, allowed);
  if (extra.length > 0) {
    throw new PackError("PACK", `unknown ${label} field(s) ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new PackError("PACK", `missing ${label} field(s) ${missing.join(", ")}`);
  }
}

function parseNat(value: unknown, field: string): string {
  if (typeof value !== "string" || !NAT_STRING.test(value)) {
    throw new PackError("PACK", `${field} must be an unsigned decimal string`);
  }
  return value;
}

function parseHex32(value: unknown, field: string): string {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw new PackError("POLICY", `${field} must be 64 lowercase hex characters`);
  }
  return value;
}

function parseSigner(raw: Record<string, unknown>): LogicalSigner {
  requireKeys(raw, SIGNER_KEYS, "signer");
  if (typeof raw.public_key !== "string" || !raw.public_key.startsWith("edpk")) {
    throw new PackError("PACK", "signer.public_key must be an edpk");
  }
  if (typeof raw.class_id !== "string" || raw.class_id.length < 1) {
    throw new PackError("PACK", "class_id must be a non-empty string");
  }
  if (typeof raw.active !== "boolean") {
    throw new PackError("PACK", "signer.active must be a JSON boolean");
  }
  return { public_key: raw.public_key, class_id: raw.class_id, active: raw.active };
}

function parseAssetPolicy(raw: Record<string, unknown>): LogicalAssetPolicy {
  requireKeys(raw, ASSET_POLICY_KEYS, "asset policy");
  return {
    decimals: parseNat(raw.decimals, "decimals"),
    max_observation_age_seconds: parseNat(raw.max_observation_age_seconds, "max_observation_age_seconds"),
    absolute_min_price: parseNat(raw.absolute_min_price, "absolute_min_price"),
    absolute_max_price: parseNat(raw.absolute_max_price, "absolute_max_price"),
    max_movement_bps: parseNat(raw.max_movement_bps, "max_movement_bps"),
  };
}

function parseStringMap<T>(
  value: unknown,
  field: string,
  parseValue: (entry: unknown, key: string) => T,
): Record<string, T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PackError("PACK", `${field} must be an object`);
  }
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = parseValue(entry, key);
  }
  return out;
}

export function parseLogicalInit(input: unknown): LogicalInit {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PackError("PACK", "init must be an object");
  }
  const raw = input as Record<string, unknown>;
  requireKeys(raw, INIT_KEYS, "init");
  if (typeof raw.admin !== "string" || typeof raw.guardian !== "string") {
    throw new PackError("PACK", "admin and guardian must be addresses");
  }
  const signers = parseStringMap(raw.signers, "signers", (entry, key) => {
    parseNat(key, "signers index");
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PackError("PACK", "signer entry must be an object");
    }
    return parseSigner(entry as Record<string, unknown>);
  });
  const assets = parseStringMap(raw.assets, "assets", (entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PackError("PACK", "asset policy must be an object");
    }
    return parseAssetPolicy(entry as Record<string, unknown>);
  });
  const groups = parseStringMap(raw.groups, "groups", (entry) => {
    if (!Array.isArray(entry) || entry.some((id) => typeof id !== "string")) {
      throw new PackError("PACK", "group asset list must be strings");
    }
    return entry as string[];
  });
  const class_minima = parseStringMap(raw.class_minima, "class_minima", (entry) =>
    parseNat(typeof entry === "string" ? entry : String(entry), "class_minima"),
  );
  return {
    admin: raw.admin,
    guardian: raw.guardian,
    config_version: parseNat(raw.config_version, "config_version"),
    policy_hash: parseHex32(raw.policy_hash, "policy_hash"),
    threshold_n: parseNat(raw.threshold_n, "threshold_n"),
    threshold_m: parseNat(raw.threshold_m, "threshold_m"),
    activation_delay_levels: parseNat(raw.activation_delay_levels, "activation_delay_levels"),
    min_activation_delay_levels: parseNat(raw.min_activation_delay_levels, "min_activation_delay_levels"),
    max_clock_skew_seconds: parseNat(raw.max_clock_skew_seconds, "max_clock_skew_seconds"),
    validity_window_seconds: parseNat(raw.validity_window_seconds, "validity_window_seconds"),
    price_nat_max: parseNat(raw.price_nat_max, "price_nat_max"),
    signers,
    class_minima,
    groups,
    assets,
  };
}

function parsePrefix(raw: Record<string, unknown>): {
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
} {
  if (typeof raw.chain_id !== "string" || validateChain(raw.chain_id) !== ValidationResult.VALID) {
    throw new PackError("CHAIN", "chain_id is not a valid Tezos chain_id");
  }
  if (
    typeof raw.oracle_address !== "string" ||
    !raw.oracle_address.startsWith("KT1") ||
    validateContractAddress(raw.oracle_address) !== ValidationResult.VALID
  ) {
    throw new PackError("ORACLE", "oracle_address must be a KT1 contract");
  }
  return {
    chain_id: raw.chain_id,
    oracle_address: raw.oracle_address,
    current_config_version: parseNat(raw.current_config_version, "current_config_version"),
    governance_nonce: parseNat(raw.governance_nonce, "governance_nonce"),
    valid_until: parseNat(raw.valid_until, "valid_until"),
  };
}

export function parseLogicalConfigIntent(input: unknown): LogicalConfigIntent {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PackError("PACK", "intent must be an object");
  }
  const raw = input as Record<string, unknown>;
  requireKeys(raw, CONFIG_INTENT_KEYS, "config intent");
  if (raw.domain !== CONFIG_DOMAIN) {
    throw new PackError("DOMAIN", `domain must be exactly ${CONFIG_DOMAIN}`);
  }
  return { domain: CONFIG_DOMAIN, ...parsePrefix(raw), init: parseLogicalInit(raw.init) };
}

export function parseLogicalSimpleIntent(input: unknown): LogicalSimpleIntent {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PackError("PACK", "intent must be an object");
  }
  const raw = input as Record<string, unknown>;
  requireKeys(raw, SIMPLE_INTENT_KEYS, "governance intent");
  if (typeof raw.domain !== "string" || !(SIMPLE_GOVERNANCE_DOMAINS as readonly string[]).includes(raw.domain)) {
    throw new PackError("DOMAIN", "unsupported simple governance domain");
  }
  return {
    domain: raw.domain as LogicalSimpleIntent["domain"],
    ...parsePrefix(raw),
  };
}

export function parseLogicalAssetIntent(input: unknown): LogicalAssetIntent {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PackError("PACK", "intent must be an object");
  }
  const raw = input as Record<string, unknown>;
  requireKeys(raw, ASSET_INTENT_KEYS, "asset governance intent");
  if (typeof raw.domain !== "string" || !(ASSET_GOVERNANCE_DOMAINS as readonly string[]).includes(raw.domain)) {
    throw new PackError("DOMAIN", "unsupported asset governance domain");
  }
  if (typeof raw.asset_id !== "string" || raw.asset_id.length < 1) {
    throw new PackError("ASSET_ID", "asset_id must be a non-empty string");
  }
  return {
    domain: raw.domain as LogicalAssetIntent["domain"],
    ...parsePrefix(raw),
    asset_id: raw.asset_id,
  };
}
