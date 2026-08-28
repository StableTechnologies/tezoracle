import { blake2b256Hex } from "../packing/pack.js";
import type { PublicationGroup } from "../packing/types.js";
import type { AssetConfig, RegisterSnapshot } from "../config/validate.js";
import { canonicalJson } from "./canonical.js";
import { ValidatorError } from "./errors.js";
import type { RefusalCode } from "./errors.js";
import type { AssetEvidence, DerivedAsset, SharedEvidenceManifest, SourceObservation } from "./types.js";
import { EVIDENCE_DOMAIN } from "./types.js";

const MANIFEST_KEYS = ["assets", "domain", "policy_hash", "publication_group", "round"] as const;
const ASSET_KEYS = ["asset_id", "calculation", "decimals", "excluded", "observation_time", "price", "sources"] as const;
const CALC_KEYS = [
  "aggregation",
  "contributing_source_ids",
  "min_independent_observations",
  "oldest_observation_time",
  "rounding_mode",
] as const;
const SOURCE_KEYS = [
  "base_asset",
  "conversion",
  "endpoint",
  "independence_group",
  "market_id",
  "normalized_price",
  "query",
  "quote_asset",
  "raw_decimals",
  "raw_price",
  "source_id",
  "unit",
  "venue",
  "venue_observation_time",
] as const;
const CONVERSION_KEYS = ["factor", "factor_decimals", "factor_observation_time", "via_asset_id"] as const;
const EXCLUDED_KEYS = ["code", "detail", "source_id"] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const POSITIVE_NAT = /^[1-9][0-9]*$/;
const SECRET_KEY = /secret|password|authorization|api[_-]?key|private[_-]?key/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function missingKeys(value: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((key) => !(key in value));
}

function lexSorted(values: string[]): boolean {
  return values.every((value, i) => i === 0 || values[i - 1]! <= value);
}

function walkSecrets(value: unknown, path: string): void {
  if (typeof value === "string" && SECRET_KEY.test(path.split(".").pop() ?? "")) {
    throw new ValidatorError("EVIDENCE_SECRET", `credential-shaped field ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkSecrets(item, `${path}[${i}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        throw new ValidatorError("EVIDENCE_SECRET", `credential-shaped field ${path}.${key}`);
      }
      walkSecrets(child, `${path}.${key}`);
    }
  }
}

export function contributingTime(observation: SourceObservation): number {
  if (observation.conversion) {
    return Math.min(observation.venue_observation_time, observation.conversion.factor_observation_time);
  }
  return observation.venue_observation_time;
}

export function buildSharedManifest(args: {
  snapshot: RegisterSnapshot;
  policy_hash: string;
  publication_group: PublicationGroup;
  round: string;
  assets: DerivedAsset[];
}): SharedEvidenceManifest {
  const expected = args.snapshot.register.publication_groups[args.publication_group]?.asset_ids;
  if (!expected) {
    throw new ValidatorError("EVIDENCE_GROUP", `publication_group ${args.publication_group} is not in the register`);
  }
  const byId = new Map(args.assets.map((asset) => [asset.asset_id, asset]));
  const assets: AssetEvidence[] = expected.map((assetId) => {
    const derived = byId.get(assetId);
    if (!derived) {
      throw new ValidatorError("EVIDENCE_GROUP", `missing derived asset ${assetId}`);
    }
    const contributing = derived.sources.map((source) => source.source_id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      asset_id: derived.asset_id,
      price: derived.price.toString(),
      decimals: derived.decimals,
      observation_time: derived.observation_time,
      calculation: {
        aggregation: "median_lower",
        rounding_mode: "half_away_from_zero",
        min_independent_observations: derived.min_independent_observations,
        contributing_source_ids: contributing,
        oldest_observation_time: derived.observation_time,
      },
      sources: [...derived.sources].sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0)),
      excluded: [...derived.excluded].sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0)),
    };
  });

  return {
    domain: EVIDENCE_DOMAIN,
    policy_hash: args.policy_hash,
    publication_group: args.publication_group,
    round: args.round,
    assets,
  };
}

export function evidenceDigestHex(manifest: SharedEvidenceManifest): string {
  return blake2b256Hex(new TextEncoder().encode(canonicalJson(manifest)));
}

export function parseSharedManifest(raw: unknown): SharedEvidenceManifest {
  walkSecrets(raw, "evidence");
  if (!isObject(raw)) {
    throw new ValidatorError("EVIDENCE_CANON", "manifest must be an object");
  }
  if (extraKeys(raw, MANIFEST_KEYS).length > 0 || missingKeys(raw, MANIFEST_KEYS).length > 0) {
    throw new ValidatorError("EVIDENCE_CANON", "manifest fields are not exact");
  }
  if (raw.domain !== EVIDENCE_DOMAIN) {
    throw new ValidatorError("EVIDENCE_DOMAIN", "domain must be TEZORACLE_EVIDENCE_V1");
  }
  if (typeof raw.policy_hash !== "string" || !HEX64.test(raw.policy_hash)) {
    throw new ValidatorError("EVIDENCE_POLICY", "policy_hash must be 64 lowercase hex characters");
  }
  if (typeof raw.publication_group !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(raw.publication_group)) {
    throw new ValidatorError("EVIDENCE_GROUP", "publication_group is not a register group name");
  }
  if (typeof raw.round !== "string" || !POSITIVE_NAT.test(raw.round)) {
    throw new ValidatorError("EVIDENCE_CANON", "round must be a positive decimal string");
  }
  if (!Array.isArray(raw.assets)) {
    throw new ValidatorError("EVIDENCE_CANON", "assets must be an array");
  }
  const assets = raw.assets.map((item) => parseAssetEvidence(item));
  if (!lexSorted(assets.map((asset) => asset.asset_id))) {
    throw new ValidatorError("EVIDENCE_GROUP", "assets must match the payload group set in lexicographic order");
  }
  return {
    domain: EVIDENCE_DOMAIN,
    policy_hash: raw.policy_hash,
    publication_group: raw.publication_group,
    round: raw.round,
    assets,
  };
}

function parseAssetEvidence(raw: unknown): AssetEvidence {
  if (!isObject(raw) || extraKeys(raw, ASSET_KEYS).length > 0 || missingKeys(raw, ASSET_KEYS).length > 0) {
    throw new ValidatorError("EVIDENCE_CANON", "asset evidence fields are not exact");
  }
  if (typeof raw.asset_id !== "string" || !/^[A-Z0-9_]+$/.test(raw.asset_id)) {
    throw new ValidatorError("EVIDENCE_GROUP", "asset_id must be a canonical register id");
  }
  if (typeof raw.price !== "string" || !POSITIVE_NAT.test(raw.price)) {
    throw new ValidatorError("EVIDENCE_PRICE", "price must be a positive nat string");
  }
  if (typeof raw.decimals !== "number" || !Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 18) {
    throw new ValidatorError("EVIDENCE_PRICE", "decimals must be a JSON integer 0..18");
  }
  if (typeof raw.observation_time !== "number" || !Number.isInteger(raw.observation_time) || raw.observation_time < 1) {
    throw new ValidatorError("EVIDENCE_PRICE", "observation_time must be a positive integer");
  }
  if (!isObject(raw.calculation) || extraKeys(raw.calculation, CALC_KEYS).length > 0 || missingKeys(raw.calculation, CALC_KEYS).length > 0) {
    throw new ValidatorError("EVIDENCE_CANON", "calculation fields are not exact");
  }
  const calc = raw.calculation;
  if (calc.aggregation !== "median_lower" || calc.rounding_mode !== "half_away_from_zero") {
    throw new ValidatorError("EVIDENCE_CANON", "calculation policy is not the frozen policy");
  }
  if (typeof calc.min_independent_observations !== "number" || !Number.isInteger(calc.min_independent_observations)) {
    throw new ValidatorError("EVIDENCE_CANON", "min_independent_observations must be an integer");
  }
  if (typeof calc.oldest_observation_time !== "number" || calc.oldest_observation_time !== raw.observation_time) {
    throw new ValidatorError("EVIDENCE_TIME", "oldest_observation_time must equal observation_time");
  }
  if (!Array.isArray(calc.contributing_source_ids) || calc.contributing_source_ids.some((id) => typeof id !== "string")) {
    throw new ValidatorError("EVIDENCE_CANON", "contributing_source_ids must be strings");
  }
  const contributing = calc.contributing_source_ids as string[];
  if (!lexSorted(contributing)) {
    throw new ValidatorError("EVIDENCE_CANON", "contributing_source_ids must be lexicographic");
  }
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.excluded)) {
    throw new ValidatorError("EVIDENCE_CANON", "sources and excluded must be arrays");
  }
  const sources = raw.sources.map(parseSourceObservation);
  const excluded = raw.excluded.map(parseExcluded);
  if (!lexSorted(sources.map((source) => source.source_id)) || !lexSorted(excluded.map((item) => item.source_id))) {
    throw new ValidatorError("EVIDENCE_CANON", "sources and excluded must be lexicographic by source_id");
  }
  const sourceIds = sources.map((source) => source.source_id);
  if (sourceIds.join("\0") !== contributing.join("\0")) {
    throw new ValidatorError("EVIDENCE_CANON", "contributing_source_ids must match sources");
  }
  const overlap = new Set(sourceIds);
  if (excluded.some((item) => overlap.has(item.source_id))) {
    throw new ValidatorError("EVIDENCE_CANON", "a source cannot be both contributing and excluded");
  }
  const oldest = sources.reduce((min, source) => Math.min(min, contributingTime(source)), Number.POSITIVE_INFINITY);
  if (sources.length === 0 || oldest !== raw.observation_time) {
    throw new ValidatorError("EVIDENCE_TIME", "observation_time must be the minimum contributing time");
  }
  return {
    asset_id: raw.asset_id,
    price: raw.price,
    decimals: raw.decimals,
    observation_time: raw.observation_time,
    calculation: {
      aggregation: "median_lower",
      rounding_mode: "half_away_from_zero",
      min_independent_observations: calc.min_independent_observations,
      contributing_source_ids: contributing,
      oldest_observation_time: calc.oldest_observation_time,
    },
    sources,
    excluded,
  };
}

function parseSourceObservation(raw: unknown): SourceObservation {
  if (!isObject(raw) || extraKeys(raw, SOURCE_KEYS).length > 0 || missingKeys(raw, SOURCE_KEYS).length > 0) {
    throw new ValidatorError("EVIDENCE_CANON", "source observation fields are not exact");
  }
  for (const field of ["source_id", "venue", "independence_group", "market_id", "endpoint", "query", "base_asset", "quote_asset", "unit"] as const) {
    if (typeof raw[field] !== "string") {
      throw new ValidatorError("EVIDENCE_CANON", `${field} must be a string`);
    }
  }
  if (typeof raw.venue_observation_time !== "number" || !Number.isInteger(raw.venue_observation_time) || raw.venue_observation_time < 1) {
    throw new ValidatorError("EVIDENCE_TIME", "venue_observation_time must be a positive integer");
  }
  if (typeof raw.raw_price !== "string" || !POSITIVE_NAT.test(raw.raw_price)) {
    throw new ValidatorError("EVIDENCE_PRICE", "raw_price must be a positive nat string");
  }
  if (typeof raw.normalized_price !== "string" || !POSITIVE_NAT.test(raw.normalized_price)) {
    throw new ValidatorError("EVIDENCE_PRICE", "normalized_price must be a positive nat string");
  }
  if (typeof raw.raw_decimals !== "number" || !Number.isInteger(raw.raw_decimals) || raw.raw_decimals < 0) {
    throw new ValidatorError("EVIDENCE_CANON", "raw_decimals must be a nat");
  }
  let conversion: SourceObservation["conversion"] = null;
  if (raw.conversion !== null) {
    if (!isObject(raw.conversion) || extraKeys(raw.conversion, CONVERSION_KEYS).length > 0 || missingKeys(raw.conversion, CONVERSION_KEYS).length > 0) {
      throw new ValidatorError("EVIDENCE_CANON", "conversion fields are not exact");
    }
    if (raw.conversion.via_asset_id !== "USDT_USD") {
      throw new ValidatorError("EVIDENCE_SOURCE", "conversion via_asset_id must be USDT_USD");
    }
    if (typeof raw.conversion.factor !== "string" || !POSITIVE_NAT.test(raw.conversion.factor)) {
      throw new ValidatorError("EVIDENCE_PRICE", "conversion factor must be a positive nat string");
    }
    if (typeof raw.conversion.factor_decimals !== "number" || !Number.isInteger(raw.conversion.factor_decimals)) {
      throw new ValidatorError("EVIDENCE_CANON", "factor_decimals must be an integer");
    }
    if (typeof raw.conversion.factor_observation_time !== "number" || !Number.isInteger(raw.conversion.factor_observation_time)) {
      throw new ValidatorError("EVIDENCE_TIME", "factor_observation_time must be an integer");
    }
    conversion = {
      via_asset_id: "USDT_USD",
      factor: raw.conversion.factor,
      factor_decimals: raw.conversion.factor_decimals,
      factor_observation_time: raw.conversion.factor_observation_time,
    };
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
    venue_observation_time: raw.venue_observation_time,
    raw_price: raw.raw_price,
    raw_decimals: raw.raw_decimals,
    normalized_price: raw.normalized_price,
    conversion,
  };
}

function parseExcluded(raw: unknown): ExcludedSourceLike {
  if (!isObject(raw) || extraKeys(raw, EXCLUDED_KEYS).length > 0 || missingKeys(raw, EXCLUDED_KEYS).length > 0) {
    throw new ValidatorError("EVIDENCE_CANON", "excluded fields are not exact");
  }
  if (typeof raw.source_id !== "string" || typeof raw.code !== "string" || typeof raw.detail !== "string") {
    throw new ValidatorError("EVIDENCE_CANON", "excluded fields must be strings");
  }
  return { source_id: raw.source_id, code: raw.code, detail: raw.detail };
}

type ExcludedSourceLike = { source_id: string; code: string; detail: string };

export function bindManifestToRegister(
  manifest: SharedEvidenceManifest,
  snapshot: RegisterSnapshot,
  policyHash: string,
): RefusalCode | null {
  if (manifest.policy_hash !== policyHash) return "EVIDENCE_POLICY";
  const expected = snapshot.register.publication_groups[manifest.publication_group]?.asset_ids;
  if (!expected) return "EVIDENCE_GROUP";
  if (manifest.assets.length !== expected.length || manifest.assets.some((asset, i) => asset.asset_id !== expected[i])) {
    return "EVIDENCE_GROUP";
  }
  for (const assetEvidence of manifest.assets) {
    const asset = snapshot.assets[assetEvidence.asset_id];
    if (!asset) return "EVIDENCE_SOURCE";
    if (assetEvidence.calculation.min_independent_observations !== asset.min_independent_observations) {
      return "EVIDENCE_MIN";
    }
    const groups = new Set<string>();
    for (const source of assetEvidence.sources) {
      const binding = asset.sources.find((entry) => entry.source_id === source.source_id);
      if (!binding) return "EVIDENCE_SOURCE";
      if (
        binding.endpoint !== source.endpoint ||
        binding.query !== source.query ||
        binding.market_id !== source.market_id ||
        binding.venue !== source.venue ||
        binding.base_asset !== source.base_asset ||
        binding.quote_asset !== source.quote_asset
      ) {
        return "EVIDENCE_ENDPOINT";
      }
      groups.add(source.independence_group);
    }
    if (groups.size < asset.min_independent_observations) return "EVIDENCE_MIN";
  }
  return null;
}

export function bindManifestToPayload(
  manifest: SharedEvidenceManifest,
  payload: { publication_group: PublicationGroup; round: string; policy_hash: string; evidence_digest: string; assets: { asset_id: string; price: string; decimals: string; observation_time: string }[] },
): RefusalCode | null {
  if (manifest.publication_group !== payload.publication_group) return "EVIDENCE_GROUP";
  if (manifest.round !== payload.round) return "EVIDENCE_GROUP";
  if (manifest.policy_hash !== payload.policy_hash) return "EVIDENCE_POLICY";
  if (manifest.assets.length !== payload.assets.length) return "EVIDENCE_GROUP";
  for (const [i, asset] of payload.assets.entries()) {
    const evidence = manifest.assets[i];
    if (!evidence || evidence.asset_id !== asset.asset_id) return "EVIDENCE_GROUP";
    if (evidence.price !== asset.price || String(evidence.decimals) !== asset.decimals) return "EVIDENCE_PRICE";
    if (String(evidence.observation_time) !== asset.observation_time) return "EVIDENCE_PRICE";
  }
  if (evidenceDigestHex(manifest) !== payload.evidence_digest) return "EVIDENCE_DIGEST";
  return null;
}

export function minObservationsMet(asset: AssetConfig, sourceCount: number): boolean {
  return sourceCount >= asset.min_independent_observations;
}
