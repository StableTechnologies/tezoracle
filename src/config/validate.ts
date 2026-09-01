/**
 * Parameter-register loader and freeze checks.
 *
 * Full JSON Schema is config/schema.json. This module enforces the
 * invariants two implementations need before they share a policy:
 * group/asset consistency from the versioned snapshot, lifecycle,
 * source allowlists, endpoint health, and fail-closed stubs.
 *
 * Publication groups and asset IDs are not a closed CORE/USDTZ/TZBTC
 * enumeration. They are whatever the committed register lists.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ProbeStatus,
  type SourceHealth,
} from "../sources/health.js";

export type Lifecycle = "draft" | "testnet" | "shadow" | "production";

export const GROUP_NAME = /^[A-Z][A-Z0-9_]*$/;
export const ASSET_ID = /^[A-Z0-9_]+$/;

const REGISTER_KEYS = [
  "schema_version",
  "register_id",
  "lifecycle",
  "authoritative",
  "domain",
  "config_version",
  "notes",
  "publication_groups",
  "time_policy",
  "payload",
  "governance",
  "signer_environments",
  "assets",
] as const;

const ASSET_KEYS = [
  "asset_id",
  "group",
  "lifecycle",
  "authoritative",
  "consumable",
  "decimals",
  "unit",
  "timestamp_semantics",
  "market_calendar",
  "benchmark_methodology",
  "instrument_definition",
  "min_independent_observations",
  "max_observation_age_seconds",
  "max_source_deviation_bps",
  "max_set_deviation_bps",
  "max_signer_deviation_bps",
  "aggregation",
  "rounding_mode",
  "absolute_min_price",
  "absolute_max_price",
  "max_movement_bps",
  "derivation",
  "notes",
  "sources",
  "dex",
] as const;

const SOURCE_KEYS = [
  "source_id",
  "venue",
  "independence_group",
  "adapter_status",
  "source_type",
  "source_lineage",
  "instrument",
  "unit",
  "timestamp_semantics",
  "market_calendar",
  "benchmark_methodology",
  "market_id",
  "base_asset",
  "quote_asset",
  "endpoint",
  "query",
  "method",
  "timeout_ms",
  "max_response_bytes",
  "price_path",
  "timestamp_path",
  "timestamp_encoding",
  "quote_conversion",
  "result_pair_key",
  "health",
] as const;

const SOURCE_REQUIRED = SOURCE_KEYS.filter(
  (key) =>
    key !== "result_pair_key" &&
    key !== "source_type" &&
    key !== "source_lineage" &&
    key !== "instrument" &&
    key !== "unit" &&
    key !== "timestamp_semantics" &&
    key !== "market_calendar" &&
    key !== "benchmark_methodology",
);

const INSTRUMENT_KEYS = ["kind", "venue_symbol", "base", "quote", "definition"] as const;

const HEALTH_KEYS = [
  "probe_status",
  "last_http_status",
  "known_restriction",
  "eligible_for_production_quorum",
  "notes",
] as const;

const DEX_KEYS = [
  "status",
  "pools",
  "quote_size",
  "min_liquidity",
  "max_price_impact_bps",
  "twap_window_seconds",
  "min_twap_observations",
  "cross_pool_deviation_bps",
  "cold_start_policy",
  "degraded_one_pool_mode",
] as const;

const DEX_POOL_KEYS = [
  "pool_address",
  "protocol",
  "token_a_address",
  "token_a_id",
  "token_a_decimals",
  "token_b_address",
  "token_b_id",
  "token_b_decimals",
  "expected_code_hash",
] as const;

const DEX_PROTOCOLS = ["quipuswap_v1_amm", "dexter_v1_amm"] as const;

const GROUP_SPEC_KEYS = ["asset_ids"] as const;

const SIGNER_ENV_KEYS = ["status", "regions", "notes"] as const;

const PROBE_STATUSES: readonly ProbeStatus[] = ["untested", "reachable", "geo_blocked", "failed"];

export type SourceInstrument = {
  kind?: string;
  venue_symbol?: string;
  base?: string;
  quote?: string;
  definition?: string;
};

export type SourceConfig = {
  source_id: string;
  venue: string;
  independence_group: string;
  adapter_status: "initial_phase" | "stretch";
  source_type?: string;
  source_lineage?: string;
  instrument?: SourceInstrument;
  unit?: string;
  timestamp_semantics?: string;
  market_calendar?: string;
  benchmark_methodology?: string;
  market_id: string;
  base_asset: string;
  quote_asset: string;
  endpoint: string;
  query: string;
  method: "GET";
  timeout_ms: number;
  max_response_bytes: number;
  price_path: string;
  timestamp_path: string;
  timestamp_encoding: "unix_ms" | "unix_s_fractional" | "rfc3339";
  quote_conversion: "none" | "usdt_usd";
  result_pair_key?: string;
  health: SourceHealth;
};

export type DexPool = {
  pool_address: string;
  protocol: "quipuswap_v1_amm" | "dexter_v1_amm";
  token_a_address: string;
  token_a_id: number | null;
  token_a_decimals: number;
  /** "XTZ" (native, no contract address) or a KT1 token contract. */
  token_b_address: string;
  token_b_id: number | null;
  token_b_decimals: number;
  expected_code_hash: string;
};

export type DexConfig = {
  status: "pending_review" | "approved";
  pools: DexPool[];
  quote_size: string | null;
  min_liquidity: string | null;
  max_price_impact_bps: number | null;
  twap_window_seconds: number | null;
  min_twap_observations: number | null;
  cross_pool_deviation_bps: number | null;
  cold_start_policy: "fail_closed";
  degraded_one_pool_mode: false;
};

export type AssetConfig = {
  asset_id: string;
  group: string;
  lifecycle: Lifecycle;
  authoritative: boolean;
  consumable: boolean;
  decimals: number;
  unit: string;
  timestamp_semantics: string;
  market_calendar?: string;
  benchmark_methodology?: string;
  instrument_definition?: string;
  min_independent_observations: number;
  max_observation_age_seconds: number;
  max_source_deviation_bps: number;
  max_set_deviation_bps: number;
  max_signer_deviation_bps: number;
  aggregation: "median_lower";
  rounding_mode: "half_away_from_zero";
  absolute_min_price: string;
  absolute_max_price: string;
  max_movement_bps: number;
  derivation: "cex_median" | "dex_twap_times_usd" | "peg_factor_times_usd";
  notes?: string;
  sources: SourceConfig[];
  dex?: DexConfig;
};

export type GroupSpec = {
  asset_ids: string[];
};

export type SignerEnvironments = {
  status: "undeclared" | "declared";
  regions: string[];
  notes?: string;
};

export type RegisterConfig = {
  schema_version: 1;
  register_id: "tezoracle-parameter-register";
  lifecycle: Lifecycle;
  authoritative: boolean;
  domain: "TEZORACLE_V1";
  config_version: number;
  notes?: string;
  publication_groups: Record<string, GroupSpec>;
  time_policy: {
    validity_window_seconds: number;
    max_clock_skew_seconds: number;
    activation_delay_levels: number;
    min_activation_delay_levels: number;
  };
  payload: {
    price_nat_max: string;
    decimals_min: number;
    decimals_max: number;
    digest_size_bytes: 32;
  };
  governance: {
    delayed_activation: true;
    pause_immediate: true;
    unpause_delayed: true;
    production_requires_separate_approval: true;
  };
  signer_environments: SignerEnvironments;
  assets: string[];
};

export type RegisterSnapshot = {
  register: RegisterConfig;
  assets: Record<string, AssetConfig>;
};

export type ValidationError = { path: string; message: string };

const NAT_STRING = /^(0|[1-9][0-9]*)$/;
const HTTPS_ENDPOINT = /^https:\/\/[^/]+\/.+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function missingKeys(value: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((key) => !(key in value));
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function fail(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message });
}

function expectNat(errors: ValidationError[], path: string, value: unknown, min: number, max?: number): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(errors, path, "must be an integer");
    return;
  }
  if (value < min || (max !== undefined && value > max)) {
    fail(errors, path, `must be an integer in [${min}, ${max ?? "∞"}]`);
  }
}

function expectNatString(errors: ValidationError[], path: string, value: unknown): bigint | undefined {
  if (typeof value !== "string" || !NAT_STRING.test(value)) {
    fail(errors, path, "must be an unsigned decimal string without leading zeros");
    return undefined;
  }
  return BigInt(value);
}

function expectNonEmptyString(errors: ValidationError[], path: string, value: unknown): void {
  if (typeof value !== "string" || value.length < 1) {
    fail(errors, path, "must be a non-empty string");
  }
}

function lexSorted(ids: readonly string[]): boolean {
  for (let i = 1; i < ids.length; i++) {
    const prev = ids[i - 1];
    const next = ids[i];
    if (prev === undefined || next === undefined || prev >= next) return false;
  }
  return true;
}

function validateHealth(errors: ValidationError[], path: string, raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, HEALTH_KEYS)) fail(errors, `${path}.${key}`, "unknown field");
  for (const key of missingKeys(raw, ["probe_status", "last_http_status", "eligible_for_production_quorum"])) {
    fail(errors, `${path}.${key}`, "missing field");
  }
  if (!PROBE_STATUSES.includes(raw.probe_status as ProbeStatus)) {
    fail(errors, `${path}.probe_status`, `must be one of ${PROBE_STATUSES.join(", ")}`);
  }
  if (raw.last_http_status !== null) {
    expectNat(errors, `${path}.last_http_status`, raw.last_http_status, 100, 599);
  }
  if (raw.known_restriction !== undefined && raw.known_restriction !== "http_451") {
    fail(errors, `${path}.known_restriction`, "must be http_451 when present");
  }
  if (typeof raw.eligible_for_production_quorum !== "boolean") {
    fail(errors, `${path}.eligible_for_production_quorum`, "must be a boolean");
  }
  if (raw.eligible_for_production_quorum === true) {
    if (raw.probe_status !== "reachable") {
      fail(errors, `${path}.eligible_for_production_quorum`, "true is allowed only when probe_status is reachable");
    }
    if (raw.known_restriction === "http_451") {
      fail(errors, `${path}.eligible_for_production_quorum`, "http_451 sources are not production-healthy");
    }
    if (typeof raw.last_http_status !== "number" || raw.last_http_status < 200 || raw.last_http_status >= 300) {
      fail(errors, `${path}.last_http_status`, "production-eligible sources must record a 2xx probe status");
    }
  }
  if (raw.probe_status === "untested" && raw.eligible_for_production_quorum === true) {
    fail(errors, `${path}.eligible_for_production_quorum`, "untested endpoints must not count as production-healthy");
  }
  if (raw.notes !== undefined) expectNonEmptyString(errors, `${path}.notes`, raw.notes);
}

function validateInstrument(errors: ValidationError[], path: string, raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, INSTRUMENT_KEYS)) fail(errors, `${path}.${key}`, "unknown field");
  for (const field of INSTRUMENT_KEYS) {
    if (raw[field] !== undefined) expectNonEmptyString(errors, `${path}.${field}`, raw[field]);
  }
}

function validateSource(errors: ValidationError[], path: string, raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, SOURCE_KEYS)) {
    fail(errors, `${path}.${key}`, "unknown field");
  }
  for (const key of missingKeys(raw, SOURCE_REQUIRED)) {
    fail(errors, `${path}.${key}`, "missing field");
  }
  if (raw.method !== "GET") fail(errors, `${path}.method`, "must be GET");
  if (raw.adapter_status !== "initial_phase" && raw.adapter_status !== "stretch") {
    fail(errors, `${path}.adapter_status`, "must be initial_phase or stretch");
  }
  expectNonEmptyString(errors, `${path}.quote_asset`, raw.quote_asset);
  if (raw.quote_conversion !== "none" && raw.quote_conversion !== "usdt_usd") {
    fail(errors, `${path}.quote_conversion`, "must be none or usdt_usd");
  }
  if (raw.quote_conversion === "usdt_usd" && raw.quote_asset !== "USDT") {
    fail(errors, `${path}.quote_conversion`, "usdt_usd conversion requires quote_asset USDT");
  }
  if (typeof raw.endpoint !== "string" || !HTTPS_ENDPOINT.test(raw.endpoint)) {
    fail(errors, `${path}.endpoint`, "must be an https URL with a path");
  }
  if (typeof raw.query !== "string") fail(errors, `${path}.query`, "must be a string");
  expectNat(errors, `${path}.timeout_ms`, raw.timeout_ms, 1, 30_000);
  expectNat(errors, `${path}.max_response_bytes`, raw.max_response_bytes, 1, 1_048_576);
  for (const field of ["source_id", "venue", "independence_group", "market_id", "base_asset", "price_path", "timestamp_path"] as const) {
    expectNonEmptyString(errors, `${path}.${field}`, raw[field]);
  }
  const encodings = ["unix_ms", "unix_s_fractional", "rfc3339"];
  if (!encodings.includes(raw.timestamp_encoding as string)) {
    fail(errors, `${path}.timestamp_encoding`, `must be one of ${encodings.join(", ")}`);
  }
  if (raw.source_id === "kraken" && typeof raw.result_pair_key !== "string") {
    fail(errors, `${path}.result_pair_key`, "Kraken sources must pin result_pair_key");
  }
  for (const optional of ["source_type", "source_lineage", "unit", "timestamp_semantics", "market_calendar", "benchmark_methodology"] as const) {
    if (raw[optional] !== undefined) expectNonEmptyString(errors, `${path}.${optional}`, raw[optional]);
  }
  if (raw.instrument !== undefined) validateInstrument(errors, `${path}.instrument`, raw.instrument);
  validateHealth(errors, `${path}.health`, raw.health);
}

function validateDex(errors: ValidationError[], path: string, raw: unknown, derivation: string): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, DEX_KEYS)) fail(errors, `${path}.${key}`, "unknown field");
  for (const key of missingKeys(raw, DEX_KEYS)) fail(errors, `${path}.${key}`, "missing field");
  if (raw.status !== "pending_review" && raw.status !== "approved") {
    fail(errors, `${path}.status`, "must be pending_review or approved");
  }
  if (raw.cold_start_policy !== "fail_closed") {
    fail(errors, `${path}.cold_start_policy`, "must be fail_closed");
  }
  if (raw.degraded_one_pool_mode !== false) {
    fail(errors, `${path}.degraded_one_pool_mode`, "must be false");
  }
  if (!Array.isArray(raw.pools)) fail(errors, `${path}.pools`, "must be an array");
  if (derivation !== "cex_median" && raw.status !== "approved") {
    if (Array.isArray(raw.pools) && raw.pools.length !== 0) {
      fail(errors, `${path}.pools`, "pending_review stubs must use an empty pool list");
    }
    for (const field of ["quote_size", "min_liquidity", "max_price_impact_bps", "twap_window_seconds", "min_twap_observations", "cross_pool_deviation_bps"] as const) {
      if (raw[field] !== null) fail(errors, `${path}.${field}`, "pending_review stubs must be null");
    }
  }
  if (Array.isArray(raw.pools)) {
    raw.pools.forEach((pool, index) => validateDexPool(errors, `${path}.pools[${index}]`, pool));
  }
}

function validateDexPool(errors: ValidationError[], path: string, raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, DEX_POOL_KEYS)) fail(errors, `${path}.${key}`, "unknown field");
  for (const key of missingKeys(raw, DEX_POOL_KEYS)) fail(errors, `${path}.${key}`, "missing field");
  if (typeof raw.pool_address !== "string" || !raw.pool_address.startsWith("KT1")) {
    fail(errors, `${path}.pool_address`, "must be a KT1 contract address");
  }
  if (!DEX_PROTOCOLS.includes(raw.protocol as (typeof DEX_PROTOCOLS)[number])) {
    fail(errors, `${path}.protocol`, `must be one of ${DEX_PROTOCOLS.join(", ")}`);
  }
  for (const field of ["token_a_address", "token_b_address"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || !(value.startsWith("KT1") || value === "XTZ")) {
      fail(errors, `${path}.${field}`, "must be a KT1 contract address or the native XTZ literal");
    }
  }
  if (raw.token_b_address === "XTZ" && raw.token_b_id !== null) {
    fail(errors, `${path}.token_b_id`, "native XTZ has no token_id; must be null");
  }
  for (const field of ["token_a_id", "token_b_id"] as const) {
    if (raw[field] !== null && !(typeof raw[field] === "number" && Number.isInteger(raw[field]) && (raw[field] as number) >= 0)) {
      fail(errors, `${path}.${field}`, "must be a non-negative integer or null");
    }
  }
  for (const field of ["token_a_decimals", "token_b_decimals"] as const) {
    expectNat(errors, `${path}.${field}`, raw[field], 0, 18);
  }
  if (typeof raw.expected_code_hash !== "string" || raw.expected_code_hash.length === 0) {
    fail(errors, `${path}.expected_code_hash`, "must be a non-empty string");
  }
}

function validateAsset(errors: ValidationError[], path: string, raw: unknown, expectedId: string): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, ASSET_KEYS)) fail(errors, `${path}.${key}`, "unknown field");
  const required = ASSET_KEYS.filter(
    (key) =>
      key !== "notes" &&
      key !== "dex" &&
      key !== "market_calendar" &&
      key !== "benchmark_methodology" &&
      key !== "instrument_definition",
  );
  for (const key of missingKeys(raw, required)) fail(errors, `${path}.${key}`, "missing field");
  if (raw.asset_id !== expectedId) fail(errors, `${path}.asset_id`, `must equal filename id ${expectedId}`);
  if (typeof raw.asset_id !== "string" || !ASSET_ID.test(raw.asset_id)) {
    fail(errors, `${path}.asset_id`, "must match ^[A-Z0-9_]+$");
  }
  if (typeof raw.group !== "string" || !GROUP_NAME.test(raw.group)) {
    fail(errors, `${path}.group`, "must match ^[A-Z][A-Z0-9_]*$");
  }
  if (raw.authoritative !== false) fail(errors, `${path}.authoritative`, "must be false in this phase");
  if (raw.consumable !== false) fail(errors, `${path}.consumable`, "must be false in this phase");
  expectNonEmptyString(errors, `${path}.unit`, raw.unit);
  expectNonEmptyString(errors, `${path}.timestamp_semantics`, raw.timestamp_semantics);
  if (raw.market_calendar !== undefined) expectNonEmptyString(errors, `${path}.market_calendar`, raw.market_calendar);
  if (raw.benchmark_methodology !== undefined) {
    expectNonEmptyString(errors, `${path}.benchmark_methodology`, raw.benchmark_methodology);
  }
  if (raw.instrument_definition !== undefined) {
    expectNonEmptyString(errors, `${path}.instrument_definition`, raw.instrument_definition);
  }
  if (raw.aggregation !== "median_lower") fail(errors, `${path}.aggregation`, "must be median_lower");
  if (raw.rounding_mode !== "half_away_from_zero") {
    fail(errors, `${path}.rounding_mode`, "must be half_away_from_zero");
  }
  expectNat(errors, `${path}.decimals`, raw.decimals, 0, 18);
  expectNat(errors, `${path}.min_independent_observations`, raw.min_independent_observations, 1);
  expectNat(errors, `${path}.max_observation_age_seconds`, raw.max_observation_age_seconds, 1);
  expectNat(errors, `${path}.max_source_deviation_bps`, raw.max_source_deviation_bps, 0, 1_000_000);
  expectNat(errors, `${path}.max_set_deviation_bps`, raw.max_set_deviation_bps, 0, 1_000_000);
  expectNat(errors, `${path}.max_signer_deviation_bps`, raw.max_signer_deviation_bps, 0, 1_000_000);
  expectNat(errors, `${path}.max_movement_bps`, raw.max_movement_bps, 0, 1_000_000);
  const minPrice = expectNatString(errors, `${path}.absolute_min_price`, raw.absolute_min_price);
  const maxPrice = expectNatString(errors, `${path}.absolute_max_price`, raw.absolute_max_price);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice >= maxPrice) {
    fail(errors, `${path}.absolute_max_price`, "must be greater than absolute_min_price");
  }
  const derivations = ["cex_median", "dex_twap_times_usd", "peg_factor_times_usd"];
  if (!derivations.includes(raw.derivation as string)) {
    fail(errors, `${path}.derivation`, `must be one of ${derivations.join(", ")}`);
  }
  if (!Array.isArray(raw.sources)) {
    fail(errors, `${path}.sources`, "must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, source] of raw.sources.entries()) {
      validateSource(errors, `${path}.sources[${i}]`, source);
      if (isObject(source) && typeof source.source_id === "string") {
        if (seen.has(source.source_id)) fail(errors, `${path}.sources[${i}].source_id`, "duplicate source_id");
        seen.add(source.source_id);
      }
    }
    const initial = raw.sources.filter(
      (source) => isObject(source) && source.adapter_status === "initial_phase",
    );
    if (raw.derivation === "cex_median") {
      const independent = new Set(
        initial
          .filter(isObject)
          .map((source) => source.independence_group)
          .filter((group): group is string => typeof group === "string"),
      );
      if (typeof raw.min_independent_observations === "number" && independent.size < raw.min_independent_observations) {
        fail(
          errors,
          `${path}.min_independent_observations`,
          "testnet minimum exceeds initial_phase independent sources listed in the allowlist",
        );
      }
    }
  }
  if (raw.derivation === "cex_median") {
    if (raw.dex !== undefined) fail(errors, `${path}.dex`, "must be omitted for cex_median assets");
  } else {
    if (raw.dex === undefined) fail(errors, `${path}.dex`, "required for DEX-derived assets");
    else validateDex(errors, `${path}.dex`, raw.dex, String(raw.derivation));
    if (Array.isArray(raw.sources) && raw.sources.length !== 0) {
      fail(errors, `${path}.sources`, "stub DEX assets must not list CEX sources");
    }
    if (raw.lifecycle === "production") {
      fail(errors, `${path}.lifecycle`, "production is not authorized in this phase");
    }
  }
  if (raw.lifecycle === "production") {
    fail(errors, `${path}.lifecycle`, "production is not authorized in this phase");
  }
}

function validateSignerEnvironments(errors: ValidationError[], raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, "register.signer_environments", "must be an object");
    return;
  }
  for (const key of extraKeys(raw, SIGNER_ENV_KEYS)) fail(errors, `register.signer_environments.${key}`, "unknown field");
  for (const key of missingKeys(raw, ["status", "regions"])) {
    fail(errors, `register.signer_environments.${key}`, "missing field");
  }
  if (raw.status !== "undeclared" && raw.status !== "declared") {
    fail(errors, "register.signer_environments.status", "must be undeclared or declared");
  }
  if (!Array.isArray(raw.regions) || raw.regions.some((region) => typeof region !== "string" || region.length < 1)) {
    fail(errors, "register.signer_environments.regions", "must be an array of non-empty strings");
    return;
  }
  if (raw.status === "undeclared" && raw.regions.length !== 0) {
    fail(errors, "register.signer_environments.regions", "must be empty while status is undeclared");
  }
  if (raw.status === "declared" && raw.regions.length < 1) {
    fail(errors, "register.signer_environments.regions", "declared signer environments must list at least one region");
  }
  if (raw.notes !== undefined) expectNonEmptyString(errors, "register.signer_environments.notes", raw.notes);
}

function validatePublicationGroups(
  errors: ValidationError[],
  groups: unknown,
  registerAssets: readonly string[],
): void {
  if (!isObject(groups)) {
    fail(errors, "register.publication_groups", "must be an object");
    return;
  }
  const names = Object.keys(groups);
  if (names.length < 1) {
    fail(errors, "register.publication_groups", "must list at least one group");
    return;
  }
  const seenAssets = new Set<string>();
  const union: string[] = [];
  for (const name of names) {
    if (!GROUP_NAME.test(name)) {
      fail(errors, `register.publication_groups.${name}`, "group name must match ^[A-Z][A-Z0-9_]*$");
      continue;
    }
    const spec = groups[name];
    if (!isObject(spec)) {
      fail(errors, `register.publication_groups.${name}`, "must be an object");
      continue;
    }
    for (const key of extraKeys(spec, GROUP_SPEC_KEYS)) {
      fail(errors, `register.publication_groups.${name}.${key}`, "unknown field");
    }
    if (!Array.isArray(spec.asset_ids) || spec.asset_ids.length < 1) {
      fail(errors, `register.publication_groups.${name}.asset_ids`, "must be a non-empty array");
      continue;
    }
    const ids = spec.asset_ids;
    if (ids.some((id) => typeof id !== "string" || !ASSET_ID.test(id))) {
      fail(errors, `register.publication_groups.${name}.asset_ids`, "each id must match ^[A-Z0-9_]+$");
      continue;
    }
    if (new Set(ids).size !== ids.length) {
      fail(errors, `register.publication_groups.${name}.asset_ids`, "must not contain duplicates");
    }
    if (!lexSorted(ids as string[])) {
      fail(errors, `register.publication_groups.${name}.asset_ids`, "must be UTF-8 lexicographic");
    }
    for (const id of ids) {
      if (typeof id !== "string") continue;
      if (!registerAssets.includes(id)) {
        fail(errors, `register.publication_groups.${name}.asset_ids`, `${id} is not in register.assets`);
      }
      if (seenAssets.has(id)) {
        fail(errors, `register.publication_groups.${name}.asset_ids`, `${id} appears in more than one group`);
      }
      seenAssets.add(id);
      union.push(id);
    }
  }
  const unionSorted = [...union].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(unionSorted) !== JSON.stringify([...registerAssets])) {
    fail(
      errors,
      "register.publication_groups",
      "union of group asset_ids must equal register.assets",
    );
  }
}

function validateRegister(errors: ValidationError[], raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, "register", "must be an object");
    return;
  }
  for (const key of extraKeys(raw, REGISTER_KEYS)) fail(errors, `register.${key}`, "unknown field");
  const required = REGISTER_KEYS.filter((key) => key !== "notes");
  for (const key of missingKeys(raw, required)) fail(errors, `register.${key}`, "missing field");
  if (raw.schema_version !== 1) fail(errors, "register.schema_version", "must be 1");
  if (raw.register_id !== "tezoracle-parameter-register") {
    fail(errors, "register.register_id", "must be tezoracle-parameter-register");
  }
  if (raw.domain !== "TEZORACLE_V1") fail(errors, "register.domain", "must be TEZORACLE_V1");
  if (raw.authoritative !== false) fail(errors, "register.authoritative", "must be false in this phase");
  if (raw.lifecycle === "production") {
    fail(errors, "register.lifecycle", "production lifecycle is not authorized in this phase");
  }
  expectNat(errors, "register.config_version", raw.config_version, 1);
  if (!Array.isArray(raw.assets) || raw.assets.length < 1) {
    fail(errors, "register.assets", "must be a non-empty array of asset ids");
  } else if (raw.assets.some((id) => typeof id !== "string" || !ASSET_ID.test(id))) {
    fail(errors, "register.assets", "each id must match ^[A-Z0-9_]+$");
  } else if (new Set(raw.assets).size !== raw.assets.length) {
    fail(errors, "register.assets", "must not contain duplicates");
  } else if (!lexSorted(raw.assets as string[])) {
    fail(errors, "register.assets", "must be UTF-8 lexicographic");
  }
  const assetIds = Array.isArray(raw.assets) ? (raw.assets.filter((id) => typeof id === "string") as string[]) : [];
  validatePublicationGroups(errors, raw.publication_groups, assetIds);
  validateSignerEnvironments(errors, raw.signer_environments);
  if (!isObject(raw.time_policy)) {
    fail(errors, "register.time_policy", "must be an object");
  } else {
    expectNat(errors, "register.time_policy.validity_window_seconds", raw.time_policy.validity_window_seconds, 1);
    expectNat(errors, "register.time_policy.max_clock_skew_seconds", raw.time_policy.max_clock_skew_seconds, 0);
    expectNat(errors, "register.time_policy.activation_delay_levels", raw.time_policy.activation_delay_levels, 1);
    expectNat(
      errors,
      "register.time_policy.min_activation_delay_levels",
      raw.time_policy.min_activation_delay_levels,
      1,
    );
    if (
      typeof raw.time_policy.activation_delay_levels === "number" &&
      typeof raw.time_policy.min_activation_delay_levels === "number" &&
      raw.time_policy.activation_delay_levels < raw.time_policy.min_activation_delay_levels
    ) {
      fail(errors, "register.time_policy.activation_delay_levels", "must be >= min_activation_delay_levels");
    }
  }
  if (!isObject(raw.payload)) {
    fail(errors, "register.payload", "must be an object");
  } else {
    expectNatString(errors, "register.payload.price_nat_max", raw.payload.price_nat_max);
    expectNat(errors, "register.payload.decimals_min", raw.payload.decimals_min, 0, 18);
    expectNat(errors, "register.payload.decimals_max", raw.payload.decimals_max, 0, 18);
    if (raw.payload.digest_size_bytes !== 32) fail(errors, "register.payload.digest_size_bytes", "must be 32");
  }
  if (!isObject(raw.governance)) {
    fail(errors, "register.governance", "must be an object");
  } else {
    for (const field of [
      "delayed_activation",
      "pause_immediate",
      "unpause_delayed",
      "production_requires_separate_approval",
    ] as const) {
      if (raw.governance[field] !== true) fail(errors, `register.governance.${field}`, "must be true");
    }
  }
}

export function loadSnapshot(configDir: string): { snapshot: RegisterSnapshot; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const register = parseJsonFile(join(configDir, "register.json"));
  validateRegister(errors, register);

  const assetsDir = join(configDir, "assets");
  const files = readdirSync(assetsDir)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const registerIds =
    isObject(register) && Array.isArray(register.assets)
      ? (register.assets.filter((id) => typeof id === "string") as string[])
      : [];
  const expectedFiles = registerIds.map((id) => `${id}.json`);
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    fail(errors, "assets/", `expected files ${expectedFiles.join(", ")}; found ${files.join(", ")}`);
  }

  const assets: Record<string, AssetConfig> = {};
  const groups = isObject(register) && isObject(register.publication_groups) ? register.publication_groups : {};

  for (const id of registerIds) {
    const raw = parseJsonFile(join(assetsDir, `${id}.json`));
    validateAsset(errors, `assets.${id}`, raw, id);
    if (isObject(raw)) {
      assets[id] = raw as unknown as AssetConfig;
      if (typeof raw.group === "string") {
        const spec = groups[raw.group];
        if (!isObject(spec) || !Array.isArray(spec.asset_ids) || !spec.asset_ids.includes(id)) {
          fail(errors, `assets.${id}.group`, `must name a publication group that lists ${id}`);
        }
      }
      if (typeof raw.decimals === "number" && isObject(register) && isObject(register.payload)) {
        const min = register.payload.decimals_min;
        const max = register.payload.decimals_max;
        if (typeof min === "number" && typeof max === "number" && (raw.decimals < min || raw.decimals > max)) {
          fail(errors, `assets.${id}.decimals`, "outside register payload decimal bounds");
        }
      }
    }
  }

  return {
    snapshot: { register: register as RegisterConfig, assets },
    errors,
  };
}

export function validateConfigDir(configDir: string): ValidationError[] {
  return loadSnapshot(configDir).errors;
}
