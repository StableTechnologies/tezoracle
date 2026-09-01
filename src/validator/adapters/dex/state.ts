import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { PoolSpotSample } from "./types.js";

type StoredSample = { xtz_reserve: string; token_reserve: string; timestamp: number };
export type PoolSampleState = Record<string, StoredSample[]>;

export function loadPoolSampleState(path: string | undefined): PoolSampleState {
  if (!path) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return raw as PoolSampleState;
  } catch {
    return {};
  }
}

export function savePoolSampleState(path: string, state: PoolSampleState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Injectable persistence for pool sample state, so the same derive/observe
 * code path works against a local file (CLI) or a durable store (Lambda). */
export type PoolSampleStore = {
  load(): Promise<PoolSampleState>;
  save(state: PoolSampleState): Promise<void>;
};

export function createFilePoolSampleStore(path: string): PoolSampleStore {
  return {
    async load() {
      return loadPoolSampleState(path);
    },
    async save(state) {
      savePoolSampleState(path, state);
    },
  };
}

/** Ascending by timestamp, oldest first. */
export function sampleSeries(
  state: PoolSampleState,
  pool: Pick<PoolSpotSample, "pool_address" | "protocol">,
): PoolSpotSample[] {
  const entries = state[pool.pool_address] ?? [];
  return entries
    .map((entry) => ({
      pool_address: pool.pool_address,
      protocol: pool.protocol,
      xtz_reserve: BigInt(entry.xtz_reserve),
      token_reserve: BigInt(entry.token_reserve),
      timestamp: entry.timestamp,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Appends a sample and drops anything older than `retentionSeconds` before
 * it. `retentionSeconds` MUST be larger than the TWAP's own
 * `min_window_seconds` check (computeLinearTwap requires elapsed >=
 * min_window_seconds over whatever survives here) -- pruning at exactly
 * the window size would cap elapsed at <= min_window_seconds, making the
 * window check nearly impossible to ever satisfy.
 *
 * Replaces (does not duplicate) any existing entry at the exact same
 * timestamp: verify/sign re-derive locally against the same state file a
 * few seconds after derive, and two same-second calls would otherwise
 * violate computeLinearTwap's strictly-increasing-timestamps invariant.
 */
export function recordSample(state: PoolSampleState, sample: PoolSpotSample, retentionSeconds: number): PoolSampleState {
  const cutoff = sample.timestamp - retentionSeconds;
  const existing = state[sample.pool_address] ?? [];
  const kept = existing.filter((entry) => entry.timestamp >= cutoff && entry.timestamp !== sample.timestamp);
  kept.push({
    xtz_reserve: sample.xtz_reserve.toString(),
    token_reserve: sample.token_reserve.toString(),
    timestamp: sample.timestamp,
  });
  kept.sort((a, b) => a.timestamp - b.timestamp);
  return { ...state, [sample.pool_address]: kept };
}
