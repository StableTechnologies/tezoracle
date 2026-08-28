import { ValidatorError } from "./errors.js";

/**
 * UTF-8 canonical JSON as defined in EVIDENCE_SPEC.md §4 and PARAMETER_SCHEMA.md §7.
 * Object keys are sorted by UTF-8 code units. Arrays keep their given order.
 */
export function canonicalJson(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value) || Object.is(value, -0)) {
      throw new ValidatorError("EVIDENCE_CANON", "canonical JSON numbers must be integers");
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => encode(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = keys.map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new ValidatorError("EVIDENCE_CANON", `unsupported JSON value type ${typeof value}`);
}
