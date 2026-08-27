import { ValidationResult, validateChain, validateContractAddress } from "@taquito/utils";

import { loadCommittedRegister, type RegisterPolicy } from "../config/policy.js";
import {
  ASSET_KEYS,
  DOMAIN,
  PAYLOAD_KEYS,
  PRICE_NAT_MAX,
  PackError,
  type AssetEntry,
  type LogicalPayload,
} from "./types.js";

const NAT_STRING = /^(0|[1-9][0-9]*)$/;
const POSITIVE_NAT = /^[1-9][0-9]*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ASSET_ID = /^[A-Z0-9_]+$/;
const GROUP_NAME = /^[A-Z][A-Z0-9_]*$/;

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function missingKeys(value: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((key) => !(key in value));
}

function parseNat(value: unknown, field: string, code: PackError["code"], min: bigint, max?: bigint): bigint {
  if (typeof value !== "string" || !NAT_STRING.test(value)) {
    throw new PackError(code, `${field} must be an unsigned decimal string (no JSON number, no leading zeros)`);
  }
  const n = BigInt(value);
  if (n < min || (max !== undefined && n > max)) {
    throw new PackError(code, `${field} out of range`);
  }
  return n;
}

function parseHex32(value: unknown, field: string, code: PackError["code"]): void {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw new PackError(code, `${field} must be 64 lowercase hex characters with no 0x prefix`);
  }
}

function resolvePolicy(policy?: RegisterPolicy): RegisterPolicy {
  return policy ?? loadCommittedRegister().policy;
}

export function parseLogicalPayload(input: unknown, policy?: RegisterPolicy): LogicalPayload {
  const resolved = resolvePolicy(policy);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PackError("PACK", "payload must be an object");
  }
  const raw = input as Record<string, unknown>;
  const extra = extraKeys(raw, PAYLOAD_KEYS);
  const missing = missingKeys(raw, PAYLOAD_KEYS);
  if (extra.length > 0) {
    throw new PackError("PACK", `unknown field(s) ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new PackError("PACK", `missing field(s) ${missing.join(", ")}`);
  }
  if (raw.domain !== DOMAIN) {
    throw new PackError("DOMAIN", `domain must be exactly ${DOMAIN}`);
  }
  if (typeof raw.chain_id !== "string" || validateChain(raw.chain_id) !== ValidationResult.VALID) {
    throw new PackError("CHAIN", "chain_id is not a valid Tezos chain_id");
  }
  if (
    typeof raw.oracle_address !== "string" ||
    !raw.oracle_address.startsWith("KT1") ||
    validateContractAddress(raw.oracle_address) !== ValidationResult.VALID
  ) {
    throw new PackError("ORACLE", "oracle_address must be a KT1 contract with the default entrypoint");
  }
  if (raw.oracle_address.includes("%")) {
    throw new PackError("ORACLE", "oracle_address must not include an entrypoint");
  }
  parseNat(raw.config_version, "config_version", "CONFIG", 1n);
  parseHex32(raw.policy_hash, "policy_hash", "POLICY");
  if (typeof raw.publication_group !== "string" || !GROUP_NAME.test(raw.publication_group)) {
    throw new PackError("GROUP", "publication_group must match ^[A-Z][A-Z0-9_]*$");
  }
  const group = raw.publication_group;
  const expected = resolved.groups[group];
  if (expected === undefined) {
    throw new PackError("GROUP", `publication_group ${group} is not in the parameter register`);
  }
  parseNat(raw.round, "round", "ROUND", 1n);
  const validFrom = parseNat(raw.valid_from, "valid_from", "WINDOW", 1n);
  const validUntil = parseNat(raw.valid_until, "valid_until", "WINDOW", 1n);
  if (validFrom >= validUntil) {
    throw new PackError("WINDOW", "valid_from must be strictly less than valid_until");
  }
  parseHex32(raw.evidence_digest, "evidence_digest", "EVIDENCE");
  if (!Array.isArray(raw.assets)) {
    throw new PackError("ASSETS_SET", "assets must be a list");
  }

  const ids = raw.assets.map((asset) => {
    if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
      throw new PackError("PACK", "asset entry must be an object");
    }
    return parseAsset(asset as Record<string, unknown>, resolved);
  });

  if (ids.length !== expected.length || ids.some((asset, i) => asset.asset_id !== expected[i])) {
    throw new PackError(
      "ASSETS_SET",
      `assets must be exactly ${expected.join(", ")} in that order; implementations must not sort or fill`,
    );
  }

  return {
    domain: DOMAIN,
    chain_id: raw.chain_id,
    oracle_address: raw.oracle_address,
    config_version: raw.config_version as string,
    policy_hash: raw.policy_hash as string,
    publication_group: group,
    round: raw.round as string,
    valid_from: raw.valid_from as string,
    valid_until: raw.valid_until as string,
    evidence_digest: raw.evidence_digest as string,
    assets: ids,
  };
}

function parseAsset(raw: Record<string, unknown>, policy: RegisterPolicy): AssetEntry {
  const extra = extraKeys(raw, ASSET_KEYS);
  const missing = missingKeys(raw, ASSET_KEYS);
  if (extra.length > 0) {
    throw new PackError("PACK", `unknown asset field(s) ${extra.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new PackError("PACK", `missing asset field(s) ${missing.join(", ")}`);
  }
  if (typeof raw.asset_id !== "string" || !ASSET_ID.test(raw.asset_id) || !(raw.asset_id in policy.decimals)) {
    throw new PackError("ASSET_ID", "unknown or non-canonical asset_id");
  }
  if (!POSITIVE_NAT.test(String(raw.price)) || typeof raw.price !== "string") {
    throw new PackError("PRICE", "price must be a positive decimal string");
  }
  const price = BigInt(raw.price);
  if (price > policy.priceNatMax || price > PRICE_NAT_MAX) {
    throw new PackError("PRICE", "price exceeds price_nat_max");
  }
  if (typeof raw.decimals !== "string" || !NAT_STRING.test(raw.decimals)) {
    throw new PackError("DECIMALS", "decimals must be an unsigned decimal string");
  }
  const decimals = Number(raw.decimals);
  const expectedDecimals = policy.decimals[raw.asset_id];
  if (expectedDecimals === undefined || decimals !== expectedDecimals) {
    throw new PackError("DECIMALS", `decimals must be ${expectedDecimals} for ${raw.asset_id}`);
  }
  parseNat(raw.observation_time, "observation_time", "OBS_ZERO", 1n);
  return {
    asset_id: raw.asset_id,
    price: raw.price,
    decimals: raw.decimals,
    observation_time: raw.observation_time as string,
  };
}
