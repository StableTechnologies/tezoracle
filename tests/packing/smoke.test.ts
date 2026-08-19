import assert from "node:assert/strict";
import test from "node:test";

import { PACKING_STATUS } from "../../src/packing/index.js";

test("packing is not treated as frozen in the repository skeleton", () => {
  assert.equal(PACKING_STATUS, "unfrozen");
});
