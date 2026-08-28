import assert from "node:assert/strict";
import test from "node:test";

import { loadSnapshot } from "../../src/config/validate.js";
import {
  binanceAdapter,
  coinbaseAdapter,
  createMockTransport,
  krakenAdapter,
  okxAdapter,
  sourceUrl,
} from "../../src/validator/adapters/index.js";
import { parseRfc3339Utc, parseUnixMs, parseUnixSFractional } from "../../src/validator/adapters/parse.js";
import { applyTimeAndNormalization, fetchSource } from "../../src/validator/observe.js";
import { INITIAL_PHASE_SOURCE_IDS } from "../../src/validator/adapters/registry.js";
import { CONFIG_DIR, NOW } from "./helpers.js";

const { snapshot } = loadSnapshot(CONFIG_DIR);
const usdt = snapshot.assets.USDT_USD!;
const xtz = snapshot.assets.XTZ_USD!;

function source(assetId: "USDT_USD" | "XTZ_USD" | "BTC_USD", sourceId: string) {
  const asset = snapshot.assets[assetId]!;
  const found = asset.sources.find((entry) => entry.source_id === sourceId);
  assert.ok(found, sourceId);
  return found;
}

test("all four mainnet CEX adapters are registered", () => {
  assert.deepEqual([...INITIAL_PHASE_SOURCE_IDS].sort(), ["binance", "coinbase", "kraken", "okx"]);
});

test("Binance, OKX, Kraken, and Coinbase parse register-shaped bodies", () => {
  const binance = binanceAdapter.parse(source("USDT_USD", "binance"), [
    { price: "1.000100", time: 1786679920000 },
  ]);
  assert.equal(binance.ok, true);
  if (binance.ok) assert.equal(binance.quote.priceText, "1.000100");

  const okx = okxAdapter.parse(source("USDT_USD", "okx"), {
    code: "0",
    data: [{ instId: "USDT-USD", last: "1.000200", ts: "1786679910000" }],
  });
  assert.equal(okx.ok, true);

  const kraken = krakenAdapter.parse(source("BTC_USD", "kraken"), {
    error: [],
    result: { XXBTZUSD: [["65005.00", "0.1", "1786679835.42", "b", "m", "", "1"]] },
  });
  assert.equal(kraken.ok, true);

  const coinbase = coinbaseAdapter.parse(source("XTZ_USD", "coinbase"), {
    price: "0.750200",
    time: "2026-08-14T03:57:40.000Z",
    product_id: "XTZ-USD",
  });
  assert.equal(coinbase.ok, true);
});

test("venue schema mismatches are fail-closed", () => {
  assert.equal(binanceAdapter.parse(source("USDT_USD", "binance"), {}).ok, false);
  assert.equal(okxAdapter.parse(source("USDT_USD", "okx"), { code: "1", data: [] }).ok, false);
  const wrongOkx = okxAdapter.parse(source("USDT_USD", "okx"), {
    code: "0",
    data: [{ instId: "BTC-USD", last: "1.0", ts: "1786679910000" }],
  });
  assert.equal(wrongOkx.ok, false);
  if (!wrongOkx.ok) assert.equal(wrongOkx.code, "WRONG_MARKET");

  const wrongKraken = krakenAdapter.parse(source("BTC_USD", "kraken"), {
    error: [],
    result: { XBTUSD: [["65005.00", "0.1", "1786679835.42", "b", "m", "", "1"]] },
  });
  assert.equal(wrongKraken.ok, false);
  if (!wrongKraken.ok) assert.equal(wrongKraken.code, "WRONG_MARKET");

  const scientific = binanceAdapter.parse(source("USDT_USD", "binance"), [{ price: "1e-2", time: 1786679920000 }]);
  assert.equal(scientific.ok, false);
  if (!scientific.ok) assert.equal(scientific.code, "BAD_NUMBER");
});

test("timestamp encodings follow the observer agreement", () => {
  assert.equal(parseUnixMs(1786679920000), 1786679920);
  assert.equal(parseUnixMs("1786679920000"), 1786679920);
  assert.equal(parseUnixSFractional("1786679900.1234"), 1786679900);
  assert.equal(parseRfc3339Utc("2026-08-14T03:58:50.000Z"), 1786679930);
  assert.throws(() => parseUnixMs(1.5));
  assert.throws(() => parseRfc3339Utc("2026-08-14T03:58:50+03:00"));
});

test("HTTP timeout, oversize, redirect, and stale/future times are excluded", async () => {
  const binance = source("USDT_USD", "binance");
  const url = sourceUrl(binance.endpoint, binance.query);

  const timeout = await fetchSource(binance, createMockTransport({ [url]: { body: {}, error: "TIMEOUT" } }));
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.excluded.code, "TIMEOUT");

  const oversize = await fetchSource(
    { ...binance, max_response_bytes: 8 },
    createMockTransport({ [url]: { body: [{ price: "1.000100", time: 1786679920000 }] } }),
  );
  assert.equal(oversize.ok, false);
  if (!oversize.ok) assert.equal(oversize.excluded.code, "OVERSIZE");

  const redirect = await fetchSource(
    binance,
    createMockTransport({
      [url]: {
        body: [{ price: "1.000100", time: 1786679920000 }],
        finalUrl: "https://evil.example/api/v3/trades?symbol=USDTUSD&limit=1",
      },
    }),
  );
  assert.equal(redirect.ok, false);
  if (!redirect.ok) assert.equal(redirect.excluded.code, "MALFORMED");

  const fetched = await fetchSource(
    binance,
    createMockTransport({ [url]: { body: [{ price: "1.000100", time: 1786679920000 }] } }),
  );
  assert.equal(fetched.ok, true);
  if (!fetched.ok) return;

  const stale = applyTimeAndNormalization(binance, fetched.observation, usdt, snapshot.register, NOW + 1000, undefined);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.excluded.code, "BAD_TIMESTAMP");

  const future = applyTimeAndNormalization(
    binance,
    { ...fetched.observation, venue_observation_time: NOW + 30 },
    usdt,
    snapshot.register,
    NOW,
    undefined,
  );
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.excluded.code, "BAD_TIMESTAMP");

  const okx = source("XTZ_USD", "okx");
  const xtzFetched = await fetchSource(
    okx,
    createMockTransport({
      [sourceUrl(okx.endpoint, okx.query)]: {
        body: { code: "0", data: [{ instId: "XTZ-USDT", last: "0.751000", ts: "1786679890000" }] },
      },
    }),
  );
  assert.equal(xtzFetched.ok, true);
  if (!xtzFetched.ok) return;
  const converted = applyTimeAndNormalization(okx, xtzFetched.observation, xtz, snapshot.register, NOW, {
    price: 1000100n,
    decimals: 6,
    observation_time: 1786679900,
  });
  assert.equal(converted.ok, true);
  if (converted.ok) {
    assert.equal(converted.observation.normalized_price, "751075");
    assert.equal(converted.observation.conversion?.via_asset_id, "USDT_USD");
  }
});
