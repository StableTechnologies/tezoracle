import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadSnapshot } from "../../src/config/validate.js";
import {
  classifyProbe,
  countsTowardHealthyObservations,
  countsTowardProductionQuorum,
  failClosedInsufficient,
  registerDerivationGate,
  remainingIndependentHealthy,
} from "../../src/sources/health.js";

const configDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config");

const reachable = {
  probe_status: "reachable" as const,
  last_http_status: 200,
  eligible_for_production_quorum: false,
};

test("HTTP 451 is geo-blocked and never counts as a healthy observation", () => {
  assert.equal(classifyProbe({ kind: "http", status: 451 }), "geo_blocked");
  assert.equal(
    countsTowardHealthyObservations({
      adapter_status: "initial_phase",
      health: reachable,
      probe: { kind: "http", status: 451 },
    }),
    false,
  );
});

test("untested endpoints never count, even with a live HTTP 200", () => {
  assert.equal(
    countsTowardHealthyObservations({
      adapter_status: "initial_phase",
      health: {
        probe_status: "untested",
        last_http_status: null,
        eligible_for_production_quorum: false,
      },
      probe: { kind: "http", status: 200 },
    }),
    false,
  );
  const gate = registerDerivationGate({
    adapter_status: "initial_phase",
    health: { probe_status: "untested", last_http_status: null, eligible_for_production_quorum: false },
  });
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.code, "UNTESTED");
});

test("untested endpoints are not production-healthy even if listed as initial_phase", () => {
  const { snapshot, errors } = loadSnapshot(configDir);
  assert.equal(errors.length, 0);
  for (const asset of Object.values(snapshot.assets)) {
    for (const source of asset.sources) {
      assert.equal(
        countsTowardProductionQuorum({ adapter_status: source.adapter_status, health: source.health }),
        false,
        `${asset.asset_id}/${source.source_id}`,
      );
      assert.equal(
        countsTowardHealthyObservations({ adapter_status: source.adapter_status, health: source.health }),
        false,
        `${asset.asset_id}/${source.source_id}`,
      );
    }
  }
});

test("Binance 451 from a signer region fail-closes CORE below min independent observations", () => {
  const remaining = remainingIndependentHealthy(
    [
      {
        adapter_status: "initial_phase",
        health: reachable,
        probe: { kind: "http", status: 451 },
      },
      {
        adapter_status: "initial_phase",
        health: reachable,
        probe: { kind: "http", status: 200 },
      },
    ],
    ["binance", "okx"],
  );
  assert.equal(remaining, 1);
  const { snapshot } = loadSnapshot(configDir);
  const usdt = snapshot.assets.USDT_USD;
  assert.ok(usdt);
  assert.equal(failClosedInsufficient(remaining, usdt.min_independent_observations), true);
});
