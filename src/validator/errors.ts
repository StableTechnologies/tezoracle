export const REFUSAL_CODES = [
  "TIMEOUT",
  "HTTP_STATUS",
  "MALFORMED",
  "OVERSIZE",
  "BAD_NUMBER",
  "BAD_TIMESTAMP",
  "WRONG_MARKET",
  "UNAPPROVED_SOURCE",
  "OUTLIER",
  "INSUFFICIENT",
  "SET_DIVERGENCE",
  "BOUNDS",
  "DEX_LIQUIDITY",
  "DEX_TWAP",
  "DEX_CROSS",
  "PAUSED",
  "POLICY_PIN",
  "CANDIDATE_MISMATCH",
  "INTERNAL",
  "EVIDENCE_DOMAIN",
  "EVIDENCE_CANON",
  "EVIDENCE_POLICY",
  "EVIDENCE_GROUP",
  "EVIDENCE_PRICE",
  "EVIDENCE_SOURCE",
  "EVIDENCE_ENDPOINT",
  "EVIDENCE_DIGEST",
  "EVIDENCE_LOCAL",
  "EVIDENCE_TIME",
  "EVIDENCE_MIN",
  "EVIDENCE_SECRET",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export class ValidatorError extends Error {
  readonly code: RefusalCode;

  constructor(code: RefusalCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ValidatorError";
    this.code = code;
  }
}

export function isRefusalCode(value: string): value is RefusalCode {
  return (REFUSAL_CODES as readonly string[]).includes(value);
}
