/**
 * Production quorum-shared evidence builder.
 *
 * Consumes independently collected observations. It MUST NOT copy prices,
 * timestamps, or source status from a candidate payload.
 */

import type { RegisterSnapshot } from "../config/validate.js";
import {
  EVIDENCE_DOMAIN,
  EvidenceError,
  type IndependentAssetObservations,
  type SharedEvidenceManifest,
  type SourceObservation,
} from "./types.js";

export type { IndependentAssetObservations };

function sortBySourceId<T extends { source_id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0));
}

function independentCount(sources: readonly SourceObservation[]): number {
  return new Set(sources.map((source) => source.independence_group)).size;
}

export function buildSharedManifest(args: {
  snapshot: RegisterSnapshot;
  policy_hash: string;
  publication_group: string;
  round: string;
  assets: IndependentAssetObservations[];
}): SharedEvidenceManifest {
  const expected = args.snapshot.register.publication_groups[args.publication_group]?.asset_ids;
  if (!expected) {
    throw new EvidenceError("EVIDENCE_GROUP", `publication_group ${args.publication_group} is not in the register`);
  }
  const byId = new Map(args.assets.map((asset) => [asset.asset_id, asset]));
  const assets = expected.map((assetId) => {
    const observed = byId.get(assetId);
    if (!observed) {
      throw new EvidenceError("EVIDENCE_GROUP", `missing independently collected observations for ${assetId}`);
    }
    const asset = args.snapshot.assets[assetId];
    if (!asset) {
      throw new EvidenceError("EVIDENCE_SOURCE", `unknown asset ${assetId}`);
    }
    const sources = sortBySourceId(observed.sources);
    const excluded = sortBySourceId(observed.excluded);
    if (independentCount(sources) < asset.min_independent_observations) {
      throw new EvidenceError(
        "EVIDENCE_MIN",
        `${assetId} has ${independentCount(sources)} independent observations; minimum is ${asset.min_independent_observations}`,
      );
    }
    return {
      asset_id: assetId,
      price: observed.price,
      decimals: observed.decimals,
      observation_time: observed.observation_time,
      calculation: {
        aggregation: asset.aggregation,
        rounding_mode: asset.rounding_mode,
        min_independent_observations: asset.min_independent_observations,
        contributing_source_ids: sources.map((source) => source.source_id),
        oldest_observation_time: observed.observation_time,
      },
      sources,
      excluded,
    };
  });
  if (byId.size !== expected.length) {
    throw new EvidenceError("EVIDENCE_GROUP", "observation asset set does not match the publication group");
  }
  return {
    domain: EVIDENCE_DOMAIN,
    policy_hash: args.policy_hash,
    publication_group: args.publication_group,
    round: args.round,
    assets,
  };
}
