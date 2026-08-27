/**
 * Register-derived packing policy and policy_hash.
 *
 * Groups, asset IDs, and decimals come from the versioned snapshot, not from
 * a closed CORE/USDTZ/TZBTC enumeration in the packer.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { blake2b256Utf8, canonicalJson } from "../canonical.js";
import { loadSnapshot, type RegisterSnapshot } from "./validate.js";

export type RegisterPolicy = {
  groups: Record<string, readonly string[]>;
  decimals: Record<string, number>;
  priceNatMax: bigint;
};

export function policyFromSnapshot(snapshot: RegisterSnapshot): RegisterPolicy {
  const groups: Record<string, readonly string[]> = {};
  for (const [name, spec] of Object.entries(snapshot.register.publication_groups)) {
    groups[name] = spec.asset_ids;
  }
  const decimals: Record<string, number> = {};
  for (const [id, asset] of Object.entries(snapshot.assets)) {
    decimals[id] = asset.decimals;
  }
  return {
    groups,
    decimals,
    priceNatMax: BigInt(snapshot.register.payload.price_nat_max),
  };
}

export function hashPolicySnapshot(snapshot: RegisterSnapshot): string {
  return blake2b256Utf8(canonicalJson(snapshot));
}

const defaultConfigDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config");

let cached: { snapshot: RegisterSnapshot; policy: RegisterPolicy; policyHash: string } | undefined;

export function loadCommittedRegister(configDir?: string): {
  snapshot: RegisterSnapshot;
  policy: RegisterPolicy;
  policyHash: string;
} {
  if (cached && configDir === undefined) return cached;
  const dir = configDir ?? defaultConfigDir;
  const { snapshot, errors } = loadSnapshot(dir);
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }
  const result = {
    snapshot,
    policy: policyFromSnapshot(snapshot),
    policyHash: hashPolicySnapshot(snapshot),
  };
  if (configDir === undefined) cached = result;
  return result;
}
