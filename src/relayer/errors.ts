export const RELAYER_CODES = [
  "PACKED_MISMATCH",
  "SIGNATURE",
  "QUORUM",
  "DUPLICATE",
  "UNKNOWN_SIGNER",
  "INACTIVE_SIGNER",
  "CLASS_MIN",
  "SIMULATE",
  "BROADCAST",
  "CONFIRM",
  "HOLD_KEYS",
  "INTERNAL",
] as const;

export type RelayerCode = (typeof RELAYER_CODES)[number];

export class RelayerError extends Error {
  readonly code: RelayerCode;

  constructor(code: RelayerCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RelayerError";
    this.code = code;
  }
}

export function isRelayerCode(value: string): value is RelayerCode {
  return (RELAYER_CODES as readonly string[]).includes(value);
}
