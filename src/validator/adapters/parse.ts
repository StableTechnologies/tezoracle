import type { SourceConfig } from "../../config/validate.js";
import { parseDecimalString } from "../decimal.js";
import { ValidatorError } from "../errors.js";

export function getJsonPath(root: unknown, path: string): unknown {
  if (path.length === 0) {
    throw new ValidatorError("MALFORMED", "empty JSON path");
  }
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) {
      throw new ValidatorError("MALFORMED", `missing path segment ${part}`);
    }
    if (/^(0|[1-9][0-9]*)$/.test(part)) {
      const index = Number(part);
      if (!Array.isArray(current) || index >= current.length) {
        throw new ValidatorError("MALFORMED", `missing array index ${part}`);
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) {
      throw new ValidatorError("MALFORMED", `missing object field ${part}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function parseUnixMs(raw: unknown): number {
  let digits: string;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1) {
      throw new ValidatorError("BAD_TIMESTAMP", "unix_ms must be a positive integer");
    }
    digits = String(raw);
  } else if (typeof raw === "string") {
    if (!/^[1-9][0-9]*$/.test(raw) && raw !== "0") {
      throw new ValidatorError("BAD_TIMESTAMP", "unix_ms string must be digits");
    }
    digits = raw;
  } else {
    throw new ValidatorError("BAD_TIMESTAMP", "unix_ms must be an integer number or digit string");
  }
  const seconds = BigInt(digits) / 1000n;
  if (seconds < 1n || seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidatorError("BAD_TIMESTAMP", "unix_ms out of range");
  }
  return Number(seconds);
}

export function parseUnixSFractional(raw: unknown): number {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1) {
      throw new ValidatorError("BAD_TIMESTAMP", "unix_s_fractional JSON numbers must be positive integers");
    }
    return raw;
  }
  if (typeof raw !== "string" || !/^[0-9]+(\.[0-9]+)?$/.test(raw)) {
    throw new ValidatorError("BAD_TIMESTAMP", "unix_s_fractional must be a decimal string");
  }
  const intPart = raw.split(".")[0];
  if (intPart === undefined || (intPart.startsWith("0") && intPart.length > 1)) {
    throw new ValidatorError("BAD_TIMESTAMP", "unix_s_fractional integer part is malformed");
  }
  const seconds = BigInt(intPart);
  if (seconds < 1n || seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidatorError("BAD_TIMESTAMP", "unix_s_fractional out of range");
  }
  return Number(seconds);
}

export function parseRfc3339Utc(raw: unknown): number {
  if (typeof raw !== "string") {
    throw new ValidatorError("BAD_TIMESTAMP", "rfc3339 must be a string");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|\+00:00|-00:00)$/.exec(raw);
  if (!match) {
    throw new ValidatorError("BAD_TIMESTAMP", "rfc3339 must be UTC");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new ValidatorError("BAD_TIMESTAMP", "rfc3339 field out of range");
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new ValidatorError("BAD_TIMESTAMP", "rfc3339 is not a real UTC time");
  }
  const seconds = Math.trunc(utc / 1000);
  if (seconds < 1) {
    throw new ValidatorError("BAD_TIMESTAMP", "rfc3339 before Unix epoch");
  }
  return seconds;
}

export function parseVenueTimestamp(raw: unknown, encoding: SourceConfig["timestamp_encoding"]): number {
  switch (encoding) {
    case "unix_ms":
      return parseUnixMs(raw);
    case "unix_s_fractional":
      return parseUnixSFractional(raw);
    case "rfc3339":
      return parseRfc3339Utc(raw);
    default: {
      const _exhaustive: never = encoding;
      throw new ValidatorError("BAD_TIMESTAMP", `unsupported encoding ${_exhaustive}`);
    }
  }
}

export function requirePriceString(raw: unknown, field: string): string {
  if (typeof raw !== "string") {
    throw new ValidatorError("BAD_NUMBER", `${field} must be a decimal string`);
  }
  parseDecimalString(raw);
  return raw;
}
