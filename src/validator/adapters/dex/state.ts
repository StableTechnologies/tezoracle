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

/** Appends a sample and drops anything older than `windowSeconds` before it. */
export function recordSample(state: PoolSampleState, sample: PoolSpotSample, windowSeconds: number): PoolSampleState {
  const cutoff = sample.timestamp - windowSeconds;
  const existing = state[sample.pool_address] ?? [];
  const kept = existing.filter((entry) => entry.timestamp >= cutoff);
  kept.push({
    xtz_reserve: sample.xtz_reserve.toString(),
    token_reserve: sample.token_reserve.toString(),
    timestamp: sample.timestamp,
  });
  kept.sort((a, b) => a.timestamp - b.timestamp);
  return { ...state, [sample.pool_address]: kept };
}
