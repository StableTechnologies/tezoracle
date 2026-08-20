/**
 * Parameter-register loader and freeze checks.
 *
 * Full JSON Schema is config/schema.json. This module enforces the
 * invariants two implementations need before they share a policy:
 * exact group sets, lifecycle, source allowlists, and fail-closed stubs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Lifecycle = "draft" | "testnet" | "shadow" | "production";
export type PublicationGroup = "CORE" | "USDTZ" | "TZBTC";

export const CORE_ASSET_IDS = ["BTC_USD", "USDT_USD", "XTZ_USD"] as const;
export const REGISTER_ASSET_IDS = [
  "BTC_USD",
  "TZBTC_USD",
  "USDTZ_USD",
  "USDT_USD",
  "XTZ_USD",
] as const;

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

export type SourceConfig = {
  source_id: string;
  venue: string;
  independence_group: string;
  adapter_status: "initial_phase" | "stretch";
  market_id: string;
  base_asset: string;
  quote_asset: "USD" | "USDT";
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
};

export type DexConfig = {
  status: "pending_review" | "approved";
  pools: unknown[];
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
  group: PublicationGroup;
  lifecycle: Lifecycle;
  authoritative: boolean;
  consumable: boolean;
  decimals: number;
  unit: "USD";
  timestamp_semantics: "venue_observation_time";
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

export type RegisterConfig = {
  schema_version: 1;
  register_id: "tezoracle-parameter-register";
  lifecycle: Lifecycle;
  authoritative: boolean;
  domain: "TEZORACLE_V1";
  config_version: number;
  notes?: string;
  publication_groups: {
    CORE: { asset_ids: string[] };
    USDTZ: { asset_ids: string[] };
    TZBTC: { asset_ids: string[] };
  };
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
  assets: string[];
};

export type RegisterSnapshot = {
  register: RegisterConfig;
  assets: Record<string, AssetConfig>;
};

export type ValidationError = { path: string; message: string };

const NAT_STRING = /^(0|[1-9][0-9]*)$/;
const ASSET_ID = /^[A-Z0-9_]+$/;
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

function validateSource(errors: ValidationError[], path: string, raw: unknown): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, SOURCE_KEYS)) {
    fail(errors, `${path}.${key}`, "unknown field");
  }
  const required = SOURCE_KEYS.filter((key) => key !== "result_pair_key");
  for (const key of missingKeys(raw, required)) {
    fail(errors, `${path}.${key}`, "missing field");
  }
  if (raw.method !== "GET") fail(errors, `${path}.method`, "must be GET");
  if (raw.adapter_status !== "initial_phase" && raw.adapter_status !== "stretch") {
    fail(errors, `${path}.adapter_status`, "must be initial_phase or stretch");
  }
  if (raw.quote_asset !== "USD" && raw.quote_asset !== "USDT") {
    fail(errors, `${path}.quote_asset`, "must be USD or USDT");
  }
  if (raw.quote_conversion !== "none" && raw.quote_conversion !== "usdt_usd") {
    fail(errors, `${path}.quote_conversion`, "must be none or usdt_usd");
  }
  if (raw.quote_conversion === "usdt_usd" && raw.quote_asset !== "USDT") {
    fail(errors, `${path}.quote_conversion`, "usdt_usd conversion requires quote_asset USDT");
  }
  if (raw.quote_conversion === "none" && raw.quote_asset !== "USD") {
    fail(errors, `${path}.quote_conversion`, "none conversion requires quote_asset USD");
  }
  if (typeof raw.endpoint !== "string" || !HTTPS_ENDPOINT.test(raw.endpoint)) {
    fail(errors, `${path}.endpoint`, "must be an https URL with a path");
  }
  if (typeof raw.query !== "string") fail(errors, `${path}.query`, "must be a string");
  expectNat(errors, `${path}.timeout_ms`, raw.timeout_ms, 1, 30_000);
  expectNat(errors, `${path}.max_response_bytes`, raw.max_response_bytes, 1, 1_048_576);
  for (const field of ["source_id", "venue", "independence_group", "market_id", "base_asset", "price_path", "timestamp_path"] as const) {
    if (typeof raw[field] !== "string" || raw[field].length < 1) {
      fail(errors, `${path}.${field}`, "must be a non-empty string");
    }
  }
  const encodings = ["unix_ms", "unix_s_fractional", "rfc3339"];
  if (!encodings.includes(raw.timestamp_encoding as string)) {
    fail(errors, `${path}.timestamp_encoding`, `must be one of ${encodings.join(", ")}`);
  }
  if (raw.source_id === "kraken" && typeof raw.result_pair_key !== "string") {
    fail(errors, `${path}.result_pair_key`, "Kraken sources must pin result_pair_key");
  }
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
}

function validateAsset(errors: ValidationError[], path: string, raw: unknown, expectedId: string): void {
  if (!isObject(raw)) {
    fail(errors, path, "must be an object");
    return;
  }
  for (const key of extraKeys(raw, ASSET_KEYS)) fail(errors, `${path}.${key}`, "unknown field");
  const required = ASSET_KEYS.filter((key) => key !== "notes" && key !== "dex");
  for (const key of missingKeys(raw, required)) fail(errors, `${path}.${key}`, "missing field");
  if (raw.asset_id !== expectedId) fail(errors, `${path}.asset_id`, `must equal filename id ${expectedId}`);
  if (typeof raw.asset_id !== "string" || !ASSET_ID.test(raw.asset_id)) {
    fail(errors, `${path}.asset_id`, "must match ^[A-Z0-9_]+$");
  }
  if (raw.authoritative !== false) fail(errors, `${path}.authoritative`, "must be false in this phase");
  if (raw.consumable !== false) fail(errors, `${path}.consumable`, "must be false in this phase");
  if (raw.unit !== "USD") fail(errors, `${path}.unit`, "must be USD");
  if (raw.timestamp_semantics !== "venue_observation_time") {
    fail(errors, `${path}.timestamp_semantics`, "must be venue_observation_time");
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
          "testnet minimum exceeds initial_phase independent sources",
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
  if (!isObject(raw.publication_groups)) {
    fail(errors, "register.publication_groups", "must be an object");
  } else {
    const groups = raw.publication_groups;
    for (const key of extraKeys(groups, ["CORE", "USDTZ", "TZBTC"])) {
      fail(errors, `register.publication_groups.${key}`, "unknown field");
    }
    const expected: Record<string, readonly string[]> = {
      CORE: CORE_ASSET_IDS,
      USDTZ: ["USDTZ_USD"],
      TZBTC: ["TZBTC_USD"],
    };
    for (const [group, ids] of Object.entries(expected)) {
      const spec = groups[group];
      if (!isObject(spec) || !Array.isArray(spec.asset_ids)) {
        fail(errors, `register.publication_groups.${group}.asset_ids`, "must be an array");
        continue;
      }
      if (JSON.stringify(spec.asset_ids) !== JSON.stringify([...ids])) {
        fail(
          errors,
          `register.publication_groups.${group}.asset_ids`,
          `must be exactly ${ids.join(", ")} in lexicographic order`,
        );
      }
    }
  }
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
  if (!Array.isArray(raw.assets) || JSON.stringify(raw.assets) !== JSON.stringify([...REGISTER_ASSET_IDS])) {
    fail(errors, "register.assets", `must be exactly ${REGISTER_ASSET_IDS.join(", ")} in lexicographic order`);
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
  const expectedFiles = REGISTER_ASSET_IDS.map((id) => `${id}.json`);
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    fail(errors, "assets/", `expected files ${expectedFiles.join(", ")}; found ${files.join(", ")}`);
  }

  const assets: Record<string, AssetConfig> = {};
  for (const id of REGISTER_ASSET_IDS) {
    const raw = parseJsonFile(join(assetsDir, `${id}.json`));
    validateAsset(errors, `assets.${id}`, raw, id);
    if (isObject(raw)) {
      assets[id] = raw as unknown as AssetConfig;
      const expectedGroup =
        id === "USDTZ_USD" ? "USDTZ" : id === "TZBTC_USD" ? "TZBTC" : "CORE";
      if (raw.group !== expectedGroup) {
        fail(errors, `assets.${id}.group`, `must be ${expectedGroup}`);
      }
      if (id === "USDTZ_USD" || id === "TZBTC_USD") {
        if (raw.lifecycle !== "draft") fail(errors, `assets.${id}.lifecycle`, "must be draft until separately reviewed");
      } else if (raw.lifecycle === "production") {
        fail(errors, `assets.${id}.lifecycle`, "production is not authorized in this phase");
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
