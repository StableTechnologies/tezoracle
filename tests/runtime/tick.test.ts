import assert from "node:assert/strict";
import test from "node:test";

import { TICK_CADENCE_SECONDS } from "../../src/runtime/index.js";
import { runTick } from "../../src/runtime/tick.js";
import { createOracleHarness } from "../../src/runtime/oracle.js";
import { COORDINATOR_HOLDS_KEYS } from "../../src/coordinator/keys.js";
import { RELAYER_HOLDS_KEYS } from "../../src/relayer/keys.js";
import { CLASS_A_SIGNER, baseTickDeps, CHAIN_ID, ORACLE_ADDRESS, tickHarness } from "../e2e/helpers.js";

test("tick cadence is 300 seconds and transport holds no keys", () => {
  assert.equal(TICK_CADENCE_SECONDS, 300);
  assert.equal(COORDINATOR_HOLDS_KEYS, false);
  assert.equal(RELAYER_HOLDS_KEYS, false);
});

test("harness records last_round and keeps pending immature until delay", () => {
  const harness = createOracleHarness({
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
    activation_delay_levels: 1,
    level: 4,
  });
  assert.equal(harness.immaturePending(["BTC_USD"]), false);
  harness.pending.BTC_USD = {
    price: "1",
    observation_time: 1,
    round: "1",
    accepted_level: 4,
    activation_level: 5,
  };
  assert.equal(harness.immaturePending(["BTC_USD"]), true);
  assert.equal(harness.getPrice("BTC_USD").ok, false);
  harness.advanceLevel();
  const view = harness.getPrice("BTC_USD");
  assert.equal(view.ok, true);
  if (view.ok) assert.equal(view.price, "1");
  assert.equal(harness.immaturePending(["BTC_USD"]), false);
});

test("runTick refuses a secret-shaped signer set", async () => {
  const harness = tickHarness();
  const result = await runTick({
    ...baseTickDeps({ harness }),
    signerSet: {
      threshold_n: 1,
      threshold_m: 1,
      class_minima: { A: 0 },
      signers: [
        {
          index: "0",
          public_key: CLASS_A_SIGNER.secret_key,
          class_id: "A",
          active: true,
        },
      ],
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error_code, "HOLD_KEYS");
});
