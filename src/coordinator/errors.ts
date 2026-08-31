export const COORDINATOR_CODES = [
  "POLICY_PIN",
  "INTERNAL",
  "TIMEOUT",
  "QUORUM",
  "INCOMPLETE",
  "DUPLICATE",
  "UNKNOWN_SIGNER",
  "INACTIVE_SIGNER",
  "SIGNATURE",
  "PACKED_MISMATCH",
  "CLASS_MIN",
  "HOLD_KEYS",
  "STUB_GROUP",
] as const;

export type CoordinatorCode = (typeof COORDINATOR_CODES)[number];

export class CoordinatorError extends Error {
  readonly code: CoordinatorCode;

  constructor(code: CoordinatorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CoordinatorError";
    this.code = code;
  }
}

export function isCoordinatorCode(value: string): value is CoordinatorCode {
  return (COORDINATOR_CODES as readonly string[]).includes(value);
}
