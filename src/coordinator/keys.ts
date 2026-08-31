import { CoordinatorError } from "./errors.js";

/**
 * Coordinator processes hold no oracle signing keys.
 * A secret-shaped field or edsk string in coordinator state is a hard error.
 */
export const COORDINATOR_HOLDS_KEYS = false;

const SECRET_FIELD = new Set([
  "secret_key",
  "secretKey",
  "private_key",
  "privateKey",
  "mnemonic",
  "edsk",
  "TEZORACLE_SIGNER_SECRET_KEY",
]);

const EDSK = /^edsk[1-9A-HJ-NP-Za-km-z]+$/;

function containsOracleSecret(value: unknown): boolean {
  if (typeof value === "string") return EDSK.test(value);
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some(containsOracleSecret);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.has(key)) return true;
    if (containsOracleSecret(child)) return true;
  }
  return false;
}

export function assertNoOracleSigningKeys(value: unknown, context = "coordinator"): void {
  if (containsOracleSecret(value)) {
    throw new CoordinatorError("HOLD_KEYS", `${context} must not hold oracle signing keys`);
  }
}
