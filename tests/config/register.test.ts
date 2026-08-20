import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_ASSET_IDS, loadSnapshot, validateConfigDir } from "../../src/config/validate.js";

const configDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config");

test("parameter register validates against the frozen schema invariants", () => {
  const errors = validateConfigDir(configDir);
  assert.deepEqual(errors, [], errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
});

test("CORE assets are testnet/non-authoritative and USDtz/tzBTC are draft stubs", () => {
  const { snapshot, errors } = loadSnapshot(configDir);
  assert.equal(errors.length, 0);

  assert.equal(snapshot.register.domain, "TEZORACLE_V1");
  assert.equal(snapshot.register.authoritative, false);
  assert.equal(snapshot.register.lifecycle, "testnet");
  assert.equal(snapshot.register.time_policy.activation_delay_levels >= 1, true);
  assert.deepEqual(snapshot.register.publication_groups.CORE.asset_ids, [...CORE_ASSET_IDS]);

  for (const id of CORE_ASSET_IDS) {
    const asset = snapshot.assets[id];
    assert.ok(asset, id);
    assert.equal(asset.group, "CORE");
    assert.equal(asset.lifecycle, "testnet");
    assert.equal(asset.authoritative, false);
    assert.equal(asset.consumable, false);
    assert.equal(asset.decimals, 6);
    assert.equal(asset.derivation, "cex_median");
    assert.equal(asset.aggregation, "median_lower");
    const initial = asset.sources.filter((source) => source.adapter_status === "initial_phase");
    assert.deepEqual(
      initial.map((source) => source.source_id).sort(),
      ["binance", "okx"],
    );
  }

  for (const id of ["USDTZ_USD", "TZBTC_USD"] as const) {
    const asset = snapshot.assets[id];
    assert.ok(asset, id);
    assert.equal(asset.lifecycle, "draft");
    assert.equal(asset.authoritative, false);
    assert.equal(asset.consumable, false);
    assert.equal(asset.sources.length, 0);
    assert.equal(asset.dex?.status, "pending_review");
    assert.equal(asset.dex?.pools.length, 0);
    assert.equal(asset.dex?.degraded_one_pool_mode, false);
  }

  const usdt = snapshot.assets.USDT_USD;
  const xtz = snapshot.assets.XTZ_USD;
  const btc = snapshot.assets.BTC_USD;
  assert.ok(usdt && xtz && btc);
  assert.equal(usdt.sources.every((source) => source.quote_conversion === "none"), true);
  assert.equal(
    xtz.sources
      .filter((source) => source.adapter_status === "initial_phase")
      .every((source) => source.quote_conversion === "usdt_usd"),
    true,
  );
  const krakenBtc = btc.sources.find((source) => source.source_id === "kraken");
  assert.equal(krakenBtc?.market_id, "XBTUSD");
  assert.equal(krakenBtc?.base_asset, "BTC");
});
