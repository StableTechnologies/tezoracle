import { blake2b256Utf8, canonicalJson } from "../canonical.js";
import type { RegisterSnapshot } from "../config/validate.js";
import type { LogicalPayload } from "../packing/types.js";
import {
  EVIDENCE_DOMAIN,
  EvidenceError,
  type AssetEvidence,
  type ConversionLeg,
  type ExcludedSource,
  type SharedEvidenceManifest,
  type SourceObservation,
} from "./types.js";

const MANIFEST_KEYS = ["domain", "policy_hash", "publication_group", "round", "assets"] as const;
const ASSET_KEYS = ["asset_id", "price", "decimals", "observation_time", "calculation", "sources", "excluded"] as const;
const CALC_KEYS = [
  "aggregation",
  "rounding_mode",
  "min_independent_observations",
  "contributing_source_ids",
  "oldest_observation_time",
] as const;
const SOURCE_KEYS = [
  "source_id",
  "venue",
  "independence_group",
  "market_id",
  "endpoint",
  "query",
  "base_asset",
  "quote_asset",
  "unit",
  "venue_observation_time",
  "raw_price",
  "raw_decimals",
  "normalized_price",
  "conversion",
] as const;
const CONVERSION_KEYS = ["via_asset_id", "factor", "factor_decimals", "factor_observation_time"] as const;
const EXCLUDED_KEYS = ["source_id", "code", "detail"] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const NAT_STRING = /^(0|[1-9][0-9]*)$/;
const POSITIVE_NAT = /^[1-9][0-9]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extra(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function missing(value: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((key) => !(key in value));
}

function lexSorted(ids: readonly string[]): boolean {
  for (let i = 1; i < ids.length; i++) {
    const prev = ids[i - 1];
    const next = ids[i];
    if (prev === undefined || next === undefined || prev >= next) return false;
  }
  return true;
}

function expectNatString(value: unknown, field: string, positive: boolean): string {
  const re = positive ? POSITIVE_NAT : NAT_STRING;
  if (typeof value !== "string" || !re.test(value)) {
    throw new EvidenceError("EVIDENCE_CANON", `${field} must be a canonical nat string`);
  }
  return value;
}

function expectInt(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new EvidenceError("EVIDENCE_CANON", `${field} must be an integer >= ${min}`);
  }
  return value;
}

function parseConversion(raw: unknown): ConversionLeg | null {
  if (raw === null) return null;
  if (!isObject(raw)) throw new EvidenceError("EVIDENCE_CANON", "conversion must be null or an object");
  if (extra(raw, CONVERSION_KEYS).length > 0 || missing(raw, CONVERSION_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", "conversion has unknown or missing fields");
  }
  if (typeof raw.via_asset_id !== "string") {
    throw new EvidenceError("EVIDENCE_CANON", "conversion.via_asset_id must be a string");
  }
  return {
    via_asset_id: raw.via_asset_id,
    factor: expectNatString(raw.factor, "conversion.factor", true),
    factor_decimals: expectInt(raw.factor_decimals, "conversion.factor_decimals", 0),
    factor_observation_time: expectInt(raw.factor_observation_time, "conversion.factor_observation_time", 1),
  };
}

function parseSource(raw: unknown): SourceObservation {
  if (!isObject(raw)) throw new EvidenceError("EVIDENCE_CANON", "source observation must be an object");
  if (extra(raw, SOURCE_KEYS).length > 0 || missing(raw, SOURCE_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", "source observation has unknown or missing fields");
  }
  for (const field of ["source_id", "venue", "independence_group", "market_id", "endpoint", "query", "base_asset", "quote_asset", "unit"] as const) {
    if (typeof raw[field] !== "string") {
      throw new EvidenceError("EVIDENCE_CANON", `${field} must be a string`);
    }
  }
  return {
    source_id: raw.source_id as string,
    venue: raw.venue as string,
    independence_group: raw.independence_group as string,
    market_id: raw.market_id as string,
    endpoint: raw.endpoint as string,
    query: raw.query as string,
    base_asset: raw.base_asset as string,
    quote_asset: raw.quote_asset as string,
    unit: raw.unit as string,
    venue_observation_time: expectInt(raw.venue_observation_time, "venue_observation_time", 1),
    raw_price: expectNatString(raw.raw_price, "raw_price", true),
    raw_decimals: expectInt(raw.raw_decimals, "raw_decimals", 0),
    normalized_price: expectNatString(raw.normalized_price, "normalized_price", true),
    conversion: parseConversion(raw.conversion),
  };
}

function parseExcluded(raw: unknown): ExcludedSource {
  if (!isObject(raw)) throw new EvidenceError("EVIDENCE_CANON", "excluded source must be an object");
  if (extra(raw, EXCLUDED_KEYS).length > 0 || missing(raw, EXCLUDED_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", "excluded source has unknown or missing fields");
  }
  if (typeof raw.source_id !== "string" || typeof raw.code !== "string" || typeof raw.detail !== "string") {
    throw new EvidenceError("EVIDENCE_CANON", "excluded source fields must be strings");
  }
  return { source_id: raw.source_id, code: raw.code, detail: raw.detail };
}

function parseAssetEvidence(raw: unknown): AssetEvidence {
  if (!isObject(raw)) throw new EvidenceError("EVIDENCE_CANON", "asset evidence must be an object");
  if (extra(raw, ASSET_KEYS).length > 0 || missing(raw, ASSET_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", "asset evidence has unknown or missing fields");
  }
  if (typeof raw.asset_id !== "string") throw new EvidenceError("EVIDENCE_CANON", "asset_id must be a string");
  if (!isObject(raw.calculation)) throw new EvidenceError("EVIDENCE_CANON", "calculation must be an object");
  if (extra(raw.calculation, CALC_KEYS).length > 0 || missing(raw.calculation, CALC_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", "calculation has unknown or missing fields");
  }
  if (!Array.isArray(raw.calculation.contributing_source_ids) || !Array.isArray(raw.sources) || !Array.isArray(raw.excluded)) {
    throw new EvidenceError("EVIDENCE_CANON", "sources/excluded/contributing_source_ids must be arrays");
  }
  const sources = raw.sources.map(parseSource);
  const excluded = raw.excluded.map(parseExcluded);
  const contributing = raw.calculation.contributing_source_ids.map((id) => {
    if (typeof id !== "string") throw new EvidenceError("EVIDENCE_CANON", "contributing_source_ids must be strings");
    return id;
  });
  if (!lexSorted(contributing) || !lexSorted(sources.map((s) => s.source_id)) || !lexSorted(excluded.map((s) => s.source_id))) {
    throw new EvidenceError("EVIDENCE_CANON", "source id arrays must be lexicographic");
  }
  return {
    asset_id: raw.asset_id,
    price: expectNatString(raw.price, "price", true),
    decimals: expectInt(raw.decimals, "decimals", 0),
    observation_time: expectInt(raw.observation_time, "observation_time", 1),
    calculation: {
      aggregation: String(raw.calculation.aggregation),
      rounding_mode: String(raw.calculation.rounding_mode),
      min_independent_observations: expectInt(
        raw.calculation.min_independent_observations,
        "min_independent_observations",
        0,
      ),
      contributing_source_ids: contributing,
      oldest_observation_time: expectInt(raw.calculation.oldest_observation_time, "oldest_observation_time", 1),
    },
    sources,
    excluded,
  };
}

export function parseSharedManifest(input: unknown): SharedEvidenceManifest {
  if (!isObject(input)) throw new EvidenceError("EVIDENCE_CANON", "manifest must be an object");
  if (extra(input, MANIFEST_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", `unknown field(s) ${extra(input, MANIFEST_KEYS).join(", ")}`);
  }
  if (missing(input, MANIFEST_KEYS).length > 0) {
    throw new EvidenceError("EVIDENCE_CANON", `missing field(s) ${missing(input, MANIFEST_KEYS).join(", ")}`);
  }
  if (input.domain !== EVIDENCE_DOMAIN) {
    throw new EvidenceError("EVIDENCE_DOMAIN", `domain must be ${EVIDENCE_DOMAIN}`);
  }
  if (typeof input.policy_hash !== "string" || !HEX64.test(input.policy_hash)) {
    throw new EvidenceError("EVIDENCE_POLICY", "policy_hash must be 64 lowercase hex characters");
  }
  if (typeof input.publication_group !== "string") {
    throw new EvidenceError("EVIDENCE_GROUP", "publication_group must be a string");
  }
  if (typeof input.round !== "string" || !POSITIVE_NAT.test(input.round)) {
    throw new EvidenceError("EVIDENCE_CANON", "round must be a positive nat string");
  }
  if (!Array.isArray(input.assets)) throw new EvidenceError("EVIDENCE_CANON", "assets must be an array");
  return {
    domain: EVIDENCE_DOMAIN,
    policy_hash: input.policy_hash,
    publication_group: input.publication_group,
    round: input.round,
    assets: input.assets.map(parseAssetEvidence),
  };
}

export function hashSharedManifest(manifest: SharedEvidenceManifest): string {
  return blake2b256Utf8(canonicalJson(manifest));
}

export function oldestContributingTime(asset: AssetEvidence): number {
  const times: number[] = [];
  for (const source of asset.sources) {
    times.push(source.venue_observation_time);
    if (source.conversion) times.push(source.conversion.factor_observation_time);
  }
  if (times.length === 0) return asset.observation_time;
  return Math.min(...times);
}

const SECRET_FIELD = /secret|password|authorization|api[_-]?key|private[_-]?key|mnemonic|credential/i;

function walkSecrets(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;
    if (SECRET_FIELD.test(key)) {
      throw new EvidenceError("EVIDENCE_SECRET", `credential-shaped field ${childPath}`);
    }
    walkSecrets(child, childPath);
  }
}

function independentObservationCount(sources: readonly SourceObservation[]): number {
  return new Set(sources.map((source) => source.independence_group)).size;
}

/**
 * Fail-closed verification of a quorum-shared manifest against a payload and
 * the pinned register. Checks digest, min independent observations, and every
 * required source/policy field. Does not treat the candidate as a source of
 * observations.
 */
export function verifySharedManifest(
  manifest: SharedEvidenceManifest,
  payload: LogicalPayload,
  snapshot: RegisterSnapshot,
  policyHash: string,
): void {
  walkSecrets(manifest, "");
  if (hashSharedManifest(manifest) !== payload.evidence_digest) {
    throw new EvidenceError("EVIDENCE_DIGEST", "recomputed manifest digest does not match payload evidence_digest");
  }
  if (manifest.policy_hash !== policyHash || manifest.policy_hash !== payload.policy_hash) {
    throw new EvidenceError("EVIDENCE_POLICY", "manifest policy_hash does not match the pinned register");
  }
  if (manifest.publication_group !== payload.publication_group) {
    throw new EvidenceError("EVIDENCE_GROUP", "manifest publication_group does not match payload");
  }
  if (manifest.round !== payload.round) {
    throw new EvidenceError("EVIDENCE_GROUP", "manifest round does not match payload");
  }
  const expectedIds = snapshot.register.publication_groups[payload.publication_group]?.asset_ids;
  if (!expectedIds) {
    throw new EvidenceError("EVIDENCE_GROUP", `publication_group ${payload.publication_group} is not in the register`);
  }
  if (manifest.assets.length !== payload.assets.length || manifest.assets.length !== expectedIds.length) {
    throw new EvidenceError("EVIDENCE_GROUP", "manifest asset set does not match payload");
  }
  for (let i = 0; i < payload.assets.length; i++) {
    const expected = payload.assets[i];
    const actual = manifest.assets[i];
    if (!expected || !actual) throw new EvidenceError("EVIDENCE_GROUP", "missing asset evidence");
    if (actual.asset_id !== expected.asset_id || actual.asset_id !== expectedIds[i]) {
      throw new EvidenceError("EVIDENCE_GROUP", `asset order mismatch at ${expected.asset_id}`);
    }
    if (actual.price !== expected.price || String(actual.decimals) !== expected.decimals) {
      throw new EvidenceError("EVIDENCE_PRICE", `${actual.asset_id} price/decimals do not match payload`);
    }
    if (String(actual.observation_time) !== expected.observation_time) {
      throw new EvidenceError("EVIDENCE_PRICE", `${actual.asset_id} observation_time does not match payload`);
    }
    if (actual.calculation.oldest_observation_time !== actual.observation_time) {
      throw new EvidenceError("EVIDENCE_TIME", `${actual.asset_id} oldest_observation_time must equal observation_time`);
    }
    if (actual.sources.length > 0 && oldestContributingTime(actual) !== actual.observation_time) {
      throw new EvidenceError("EVIDENCE_TIME", `${actual.asset_id} observation_time is not the min contributing time`);
    }
    const contributing = actual.sources.map((source) => source.source_id);
    if (JSON.stringify(contributing) !== JSON.stringify(actual.calculation.contributing_source_ids)) {
      throw new EvidenceError("EVIDENCE_SOURCE", `${actual.asset_id} contributing_source_ids must match sources`);
    }
    const both = new Set(contributing);
    for (const excluded of actual.excluded) {
      if (both.has(excluded.source_id)) {
        throw new EvidenceError("EVIDENCE_SOURCE", `${excluded.source_id} cannot be both contributing and excluded`);
      }
    }
    const asset = snapshot.assets[actual.asset_id];
    if (!asset) throw new EvidenceError("EVIDENCE_SOURCE", `unknown asset ${actual.asset_id}`);
    if (actual.decimals !== asset.decimals) {
      throw new EvidenceError("EVIDENCE_PRICE", `${actual.asset_id} decimals do not match the register`);
    }
    if (actual.calculation.aggregation !== asset.aggregation) {
      throw new EvidenceError("EVIDENCE_POLICY", `${actual.asset_id} aggregation is not the register policy`);
    }
    if (actual.calculation.rounding_mode !== asset.rounding_mode) {
      throw new EvidenceError("EVIDENCE_POLICY", `${actual.asset_id} rounding_mode is not the register policy`);
    }
    if (actual.calculation.min_independent_observations !== asset.min_independent_observations) {
      throw new EvidenceError("EVIDENCE_POLICY", `${actual.asset_id} min_independent_observations is not the register policy`);
    }
    const independent = independentObservationCount(actual.sources);
    if (independent < asset.min_independent_observations) {
      throw new EvidenceError(
        "EVIDENCE_MIN",
        `${actual.asset_id} has ${independent} independent observations; minimum is ${asset.min_independent_observations}`,
      );
    }
    const allow = new Map(asset.sources.map((source) => [source.source_id, source]));
    for (const observation of actual.sources) {
      const registered = allow.get(observation.source_id);
      if (!registered) {
        throw new EvidenceError("EVIDENCE_SOURCE", `${observation.source_id} is not in the pinned allowlist`);
      }
      if (
        observation.venue !== registered.venue ||
        observation.independence_group !== registered.independence_group ||
        observation.base_asset !== registered.base_asset ||
        observation.quote_asset !== registered.quote_asset ||
        observation.unit !== (registered.unit ?? registered.quote_asset)
      ) {
        throw new EvidenceError("EVIDENCE_SOURCE", `${observation.source_id} source identity fields do not match the register`);
      }
      if (
        observation.endpoint !== registered.endpoint ||
        observation.query !== registered.query ||
        observation.market_id !== registered.market_id
      ) {
        throw new EvidenceError("EVIDENCE_ENDPOINT", `${observation.source_id} endpoint/query/market_id mismatch`);
      }
      if (registered.quote_conversion === "usdt_usd") {
        if (!observation.conversion || observation.conversion.via_asset_id !== "USDT_USD") {
          throw new EvidenceError("EVIDENCE_SOURCE", `${observation.source_id} is missing the required USDT/USD conversion leg`);
        }
      } else if (observation.conversion !== null) {
        throw new EvidenceError("EVIDENCE_SOURCE", `${observation.source_id} must not include a conversion leg`);
      }
    }
  }
}
