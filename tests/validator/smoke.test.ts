import assert from "node:assert/strict";
import test from "node:test";

import { INITIAL_PHASE_SOURCE_IDS, STATUS, TEZORACLE_VERSION } from "../../src/validator/index.js";

test("package version is defined", () => {
  assert.equal(typeof TEZORACLE_VERSION, "string");
  assert.ok(TEZORACLE_VERSION.length > 0);
});

test("validator status is non-production", () => {
  assert.equal(STATUS, "non-production");
});

test("Class A ships all four mainnet CEX adapters", () => {
  assert.deepEqual([...INITIAL_PHASE_SOURCE_IDS].sort(), ["binance", "coinbase", "kraken", "okx"]);
});
