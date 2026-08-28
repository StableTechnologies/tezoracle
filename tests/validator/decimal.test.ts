import assert from "node:assert/strict";
import test from "node:test";

import {
  divScale,
  medianLower,
  mulScale,
  parseDecimalString,
  roundHalfAwayFromZero,
  scaleToDecimals,
} from "../../src/validator/decimal.js";
import { ValidatorError } from "../../src/validator/errors.js";

test("parses CEX decimal strings and rejects scientific notation", () => {
  assert.deepEqual(parseDecimalString("1.000100"), { mantissa: 1000100n, decimals: 6 });
  assert.deepEqual(parseDecimalString("0.75000000"), { mantissa: 75000000n, decimals: 8 });
  assert.deepEqual(parseDecimalString("65000.12"), { mantissa: 6500012n, decimals: 2 });
  assert.deepEqual(parseDecimalString("1"), { mantissa: 1n, decimals: 0 });
  assert.throws(() => parseDecimalString("1e2"), ValidatorError);
  assert.throws(() => parseDecimalString("-1"), ValidatorError);
  assert.throws(() => parseDecimalString("+1"), ValidatorError);
  assert.throws(() => parseDecimalString(".5"), ValidatorError);
  assert.throws(() => parseDecimalString("1."), ValidatorError);
  assert.throws(() => parseDecimalString("1.2.3"), ValidatorError);
  assert.throws(() => parseDecimalString("00.5"), ValidatorError);
  assert.throws(() => parseDecimalString("0"), ValidatorError);
});

test("half-away-from-zero scaling matches the observer agreement", () => {
  assert.equal(roundHalfAwayFromZero(75n, 2, 6), 750000n);
  assert.equal(roundHalfAwayFromZero(75000000n, 8, 6), 750000n);
  assert.equal(roundHalfAwayFromZero(15n, 1, 0), 2n);
  assert.equal(roundHalfAwayFromZero(25n, 1, 0), 3n);
  assert.equal(roundHalfAwayFromZero(4n, 1, 0), 0n);
  assert.equal(scaleToDecimals(parseDecimalString("0.75000000"), 6), 750000n);
});

test("USDT conversion multiplies then divides by 10^d", () => {
  assert.equal(mulScale(750000n, 1000100n, 6), 750075n);
  assert.equal(mulScale(751000n, 1000100n, 6), 751075n);
  assert.equal(mulScale(65000000000n, 1000100n, 6), 65006500000n);
});

test("Coinbase XTZ/USDT bridge is XTZ/USD ÷ USDT/USD", () => {
  assert.equal(divScale(750200n, 1000100n, 6), 750125n);
});

test("median_lower takes the lower central value on even sets", () => {
  assert.equal(medianLower([3n]), 3n);
  assert.equal(medianLower([1n, 2n, 3n]), 2n);
  assert.equal(medianLower([1000000n, 1000100n, 1000150n, 1000200n]), 1000100n);
  assert.equal(medianLower([750075n, 751075n, 750500n, 750200n]), 750200n);
});
