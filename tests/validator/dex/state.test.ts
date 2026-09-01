import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPoolSampleState, recordSample, sampleSeries, savePoolSampleState } from "../../../src/validator/adapters/dex/state.js";
import type { PoolSpotSample } from "../../../src/validator/adapters/dex/types.js";

const POOL = { pool_address: "KT1Pool", protocol: "dexter_v1_amm" as const };

test("pool sample series round-trips through disk in ascending order", () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-dex-"));
  const path = join(dir, "state.json");
  try {
    assert.deepEqual(loadPoolSampleState(path), {});
    assert.deepEqual(sampleSeries(loadPoolSampleState(path), POOL), []);

    let state = loadPoolSampleState(path);
    const s1: PoolSpotSample = { ...POOL, xtz_reserve: 1_000_000n, token_reserve: 1_000_000n, timestamp: 100 };
    const s2: PoolSpotSample = { ...POOL, xtz_reserve: 1_100_000n, token_reserve: 1_000_000n, timestamp: 200 };
    state = recordSample(state, s1, 1800);
    state = recordSample(state, s2, 1800);
    savePoolSampleState(path, state);

    const reloaded = loadPoolSampleState(path);
    const series = sampleSeries(reloaded, POOL);
    assert.equal(series.length, 2);
    assert.equal(series[0]?.timestamp, 100);
    assert.equal(series[1]?.timestamp, 200);
    assert.equal(series[1]?.xtz_reserve, 1_100_000n);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recordSample prunes entries older than the TWAP window", () => {
  let state = loadPoolSampleState(undefined);
  state = recordSample(state, { ...POOL, xtz_reserve: 1n, token_reserve: 1n, timestamp: 0 }, 100);
  state = recordSample(state, { ...POOL, xtz_reserve: 1n, token_reserve: 1n, timestamp: 50 }, 100);
  // this sample's cutoff (250-100=150) drops the timestamp=0 and timestamp=50 entries
  state = recordSample(state, { ...POOL, xtz_reserve: 1n, token_reserve: 1n, timestamp: 250 }, 100);
  const series = sampleSeries(state, POOL);
  assert.equal(series.length, 1);
  assert.equal(series[0]?.timestamp, 250);
});

test("loadPoolSampleState fails closed (empty) on missing or malformed file", () => {
  assert.deepEqual(loadPoolSampleState(undefined), {});
  assert.deepEqual(loadPoolSampleState("/nonexistent/path/state.json"), {});
});
