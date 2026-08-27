import type { PublicationGroup } from "../packing/types.js";
import type { AssetConfig, RegisterConfig, RegisterSnapshot } from "../config/validate.js";
import type { HttpTransport } from "./adapters/http.js";
import { absDelta, exceedsBps, medianLower } from "./decimal.js";
import { ValidatorError } from "./errors.js";
import type { RefusalCode } from "./errors.js";
import { applyTimeAndNormalization, observeAssetSources, type SourceAttempt } from "./observe.js";
import { policyHashHex } from "./policy.js";
import { buildSharedManifest, evidenceDigestHex, contributingTime } from "./evidence.js";
import type { DerivedAsset, ExcludedSource, GroupDerivation, SourceObservation, UsdtFactor } from "./types.js";

export type AssetDerivation =
  | { ok: true; asset: DerivedAsset }
  | { ok: false; code: RefusalCode; detail: string; sources: SourceObservation[]; excluded: ExcludedSource[] };

function lexCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function deriveAssetFromObservations(
  asset: AssetConfig,
  attempts: SourceAttempt[],
): AssetDerivation {
  const excluded: ExcludedSource[] = [];
  const byGroup = new Map<string, SourceObservation>();

  for (const attempt of attempts) {
    if (!attempt.ok) {
      excluded.push(attempt.excluded);
      continue;
    }
    const existing = byGroup.get(attempt.observation.independence_group);
    if (existing) {
      excluded.push({
        source_id: attempt.observation.source_id,
        code: "UNAPPROVED_SOURCE",
        detail: `duplicate independence_group ${attempt.observation.independence_group}`,
      });
      continue;
    }
    byGroup.set(attempt.observation.independence_group, attempt.observation);
  }

  let healthy = [...byGroup.values()];
  if (healthy.length < asset.min_independent_observations) {
    return {
      ok: false,
      code: "INSUFFICIENT",
      detail: `${healthy.length} healthy observations < ${asset.min_independent_observations}`,
      sources: [],
      excluded,
    };
  }

  const firstMedian = medianLower(healthy.map((obs) => BigInt(obs.normalized_price)));
  const remaining: SourceObservation[] = [];
  for (const obs of healthy) {
    const price = BigInt(obs.normalized_price);
    if (exceedsBps(absDelta(price, firstMedian), firstMedian, BigInt(asset.max_source_deviation_bps))) {
      excluded.push({ source_id: obs.source_id, code: "OUTLIER", detail: "exceeds max_source_deviation_bps vs median" });
    } else {
      remaining.push(obs);
    }
  }

  if (remaining.length < asset.min_independent_observations) {
    return {
      ok: false,
      code: "INSUFFICIENT",
      detail: `remaining ${remaining.length} after outlier exclusion < ${asset.min_independent_observations}`,
      sources: [],
      excluded,
    };
  }

  const price = medianLower(remaining.map((obs) => BigInt(obs.normalized_price)));
  const lo = remaining.reduce((min, obs) => {
    const value = BigInt(obs.normalized_price);
    return value < min ? value : min;
  }, BigInt(remaining[0]!.normalized_price));
  const hi = remaining.reduce((max, obs) => {
    const value = BigInt(obs.normalized_price);
    return value > max ? value : max;
  }, BigInt(remaining[0]!.normalized_price));
  if (exceedsBps(hi - lo, price, BigInt(asset.max_set_deviation_bps))) {
    return {
      ok: false,
      code: "SET_DIVERGENCE",
      detail: "remaining set exceeds max_set_deviation_bps",
      sources: remaining,
      excluded,
    };
  }

  const minBound = BigInt(asset.absolute_min_price);
  const maxBound = BigInt(asset.absolute_max_price);
  if (price < minBound || price > maxBound) {
    return {
      ok: false,
      code: "BOUNDS",
      detail: "derived price outside absolute bounds",
      sources: remaining,
      excluded,
    };
  }

  const sources = [...remaining].sort((a, b) => lexCompare(a.source_id, b.source_id));
  const observationTime = sources.reduce((min, obs) => {
    const time = contributingTime(obs);
    return time < min ? time : min;
  }, contributingTime(sources[0]!));

  return {
    ok: true,
    asset: {
      asset_id: asset.asset_id,
      price,
      decimals: asset.decimals,
      observation_time: observationTime,
      min_independent_observations: asset.min_independent_observations,
      sources,
      excluded: [...excluded].sort((a, b) => lexCompare(a.source_id, b.source_id)),
    },
  };
}

function finalizeAttempts(
  asset: AssetConfig,
  register: RegisterConfig,
  rawAttempts: Map<string, SourceAttempt>,
  now: number,
  usdt: UsdtFactor | undefined,
): SourceAttempt[] {
  return asset.sources.map((source) => {
    const raw = rawAttempts.get(source.source_id);
    if (!raw) {
      return { ok: false, excluded: { source_id: source.source_id, code: "INTERNAL", detail: "missing attempt" } };
    }
    if (!raw.ok) return raw;
    return applyTimeAndNormalization(source, raw.observation, asset, register, now, usdt);
  });
}

export async function derivePublicationGroup(args: {
  snapshot: RegisterSnapshot;
  group: PublicationGroup;
  transport: HttpTransport;
  now: number;
  round?: string;
}): Promise<GroupDerivation> {
  const { snapshot, group, transport, now } = args;
  if (group === "USDTZ" || group === "TZBTC") {
    throw new ValidatorError("POLICY_PIN", `${group} is a non-authoritative stub and is not signed in this phase`);
  }
  if (group !== "CORE") {
    throw new ValidatorError("POLICY_PIN", `unknown publication group ${String(group)}`);
  }

  const usdtAsset = snapshot.assets.USDT_USD;
  const xtzAsset = snapshot.assets.XTZ_USD;
  const btcAsset = snapshot.assets.BTC_USD;
  if (!usdtAsset || !xtzAsset || !btcAsset) {
    throw new ValidatorError("POLICY_PIN", "CORE assets missing from the pinned register");
  }

  const [usdtRaw, xtzRaw, btcRaw] = await Promise.all([
    observeAssetSources(usdtAsset.sources, transport),
    observeAssetSources(xtzAsset.sources, transport),
    observeAssetSources(btcAsset.sources, transport),
  ]);

  const usdtDerived = deriveAssetFromObservations(
    usdtAsset,
    finalizeAttempts(usdtAsset, snapshot.register, usdtRaw, now, undefined),
  );
  if (!usdtDerived.ok) {
    throw new ValidatorError(usdtDerived.code, `USDT_USD: ${usdtDerived.detail}`);
  }

  const usdt: UsdtFactor = {
    price: usdtDerived.asset.price,
    decimals: usdtDerived.asset.decimals,
    observation_time: usdtDerived.asset.observation_time,
  };

  const xtzDerived = deriveAssetFromObservations(
    xtzAsset,
    finalizeAttempts(xtzAsset, snapshot.register, xtzRaw, now, usdt),
  );
  const btcDerived = deriveAssetFromObservations(
    btcAsset,
    finalizeAttempts(btcAsset, snapshot.register, btcRaw, now, usdt),
  );
  if (!xtzDerived.ok) {
    throw new ValidatorError(xtzDerived.code, `XTZ_USD: ${xtzDerived.detail}`);
  }
  if (!btcDerived.ok) {
    throw new ValidatorError(btcDerived.code, `BTC_USD: ${btcDerived.detail}`);
  }

  const assets = [btcDerived.asset, usdtDerived.asset, xtzDerived.asset];
  const policy_hash = policyHashHex(snapshot);
  const evidence = buildSharedManifest({
    snapshot,
    policy_hash,
    publication_group: "CORE",
    round: args.round ?? "1",
    assets,
  });
  return {
    group: "CORE",
    policy_hash,
    config_version: snapshot.register.config_version,
    assets,
    evidence,
    evidence_digest: evidenceDigestHex(evidence),
  };
}

