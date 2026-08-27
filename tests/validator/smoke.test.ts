import assert from "node:assert/strict";
import test from "node:test";

import { STATUS, TEZORACLE_VERSION } from "../../src/validator/index.js";

test("package version is defined", () => {
  assert.equal(typeof TEZORACLE_VERSION, "string");
  assert.ok(TEZORACLE_VERSION.length > 0);
});

test("validator status is non-production", () => {
  assert.equal(STATUS, "non-production");
});
