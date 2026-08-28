import { PRICE_NAT_MAX } from "../packing/types.js";
import { ValidatorError } from "./errors.js";

export type ParsedDecimal = {
  mantissa: bigint;
  decimals: number;
};

const INT_PART = /^(0|[1-9][0-9]*)$/;
const FRAC_PART = /^[0-9]+$/;

export function parseDecimalString(text: string): ParsedDecimal {
  if (typeof text !== "string") {
    throw new ValidatorError("BAD_NUMBER", "price must be a decimal string");
  }
  if (text.length === 0 || text.startsWith("-") || text.startsWith("+")) {
    throw new ValidatorError("BAD_NUMBER", "price must be a positive decimal string");
  }
  if (/[\s,]/.test(text) || /[eE]/.test(text)) {
    throw new ValidatorError("BAD_NUMBER", "price must not contain spaces, commas, or exponents");
  }
  const parts = text.split(".");
  if (parts.length > 2) {
    throw new ValidatorError("BAD_NUMBER", "price must contain at most one decimal point");
  }
  const intPart = parts[0];
  const fracPart = parts[1];
  if (intPart === undefined || intPart.length === 0) {
    throw new ValidatorError("BAD_NUMBER", "price integer part must not be empty");
  }
  if (!INT_PART.test(intPart)) {
    throw new ValidatorError("BAD_NUMBER", "price integer part is malformed");
  }
  if (parts.length === 2 && (fracPart === undefined || fracPart.length === 0 || !FRAC_PART.test(fracPart))) {
    throw new ValidatorError("BAD_NUMBER", "price fractional part is malformed");
  }
  const decimals = fracPart?.length ?? 0;
  const mantissa = BigInt(intPart + (fracPart ?? ""));
  if (mantissa === 0n) {
    throw new ValidatorError("BAD_NUMBER", "price must be positive");
  }
  return { mantissa, decimals };
}

export function roundHalfAwayFromZero(value: bigint, srcDecimals: number, dstDecimals: number): bigint {
  if (srcDecimals === dstDecimals) return value;
  if (srcDecimals < dstDecimals) {
    return value * 10n ** BigInt(dstDecimals - srcDecimals);
  }
  const d = 10n ** BigInt(srcDecimals - dstDecimals);
  const q = value / d;
  const r = value % d;
  if (2n * r > d || (2n * r === d && q > 0n)) return q + 1n;
  return q;
}

export function scaleToDecimals(parsed: ParsedDecimal, dstDecimals: number): bigint {
  return roundHalfAwayFromZero(parsed.mantissa, parsed.decimals, dstDecimals);
}

export function mulScale(left: bigint, right: bigint, decimals: number): bigint {
  return roundHalfAwayFromZero(left * right, decimals * 2, decimals);
}

/** `numer / denom` at `decimals` (used for the Coinbase XTZ/USDT bridge). */
export function divScale(numer: bigint, denom: bigint, decimals: number): bigint {
  if (denom <= 0n) {
    throw new ValidatorError("BAD_NUMBER", "division by zero");
  }
  const scaled = numer * 10n ** BigInt(decimals);
  const q = scaled / denom;
  const r = scaled % denom;
  if (2n * r > denom || (2n * r === denom && q > 0n)) return q + 1n;
  return q;
}

export function medianLower(values: readonly bigint[]): bigint {
  if (values.length === 0) {
    throw new ValidatorError("INSUFFICIENT", "median of an empty set");
  }
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  const index = n % 2 === 1 ? (n - 1) / 2 : n / 2 - 1;
  const value = sorted[index];
  if (value === undefined) {
    throw new ValidatorError("INTERNAL", "median index out of range");
  }
  return value;
}

export function exceedsBps(absDelta: bigint, center: bigint, maxBps: bigint): boolean {
  return absDelta * 10000n > maxBps * center;
}

export function absDelta(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}

export function assertPositivePrice(value: bigint, field: string): bigint {
  if (value <= 0n || value > PRICE_NAT_MAX) {
    throw new ValidatorError("BAD_NUMBER", `${field} is zero or exceeds price_nat_max`);
  }
  return value;
}
