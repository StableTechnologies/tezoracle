import { packPayload } from "../packing/pack.js";
import { parseLogicalPayload } from "../packing/validate.js";
import { payloadMicheline } from "../packing/michelson.js";
import type { LogicalPayload, Micheline } from "../packing/types.js";
import { RelayerError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import {
  SIGNED_BATCH_DOMAIN,
  type BatchSignature,
  type SignedBatch,
  type SubmitCall,
} from "./types.js";

const BATCH_KEYS = ["domain", "payload", "packed_hex", "signatures"] as const;
const SIGNATURE_KEYS = ["index", "public_key", "signature"] as const;
const NAT = /^(0|[1-9][0-9]*)$/;
const HEX = /^[0-9a-f]+$/;
const SIG = /^(edsig|sig)[1-9A-HJ-NP-Za-km-z]+$/;
const EDPK = /^edpk[1-9A-HJ-NP-Za-km-z]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function parseSignature(raw: unknown, position: number): BatchSignature {
  if (!isObject(raw)) {
    throw new RelayerError("INTERNAL", `signature ${position} must be an object`);
  }
  const extra = extraKeys(raw, SIGNATURE_KEYS);
  if (extra.length > 0) {
    throw new RelayerError("INTERNAL", `unknown signature field(s) ${extra.join(", ")}`);
  }
  if (typeof raw.index !== "string" || !NAT.test(raw.index)) {
    throw new RelayerError("UNKNOWN_SIGNER", "signature index must be an unsigned decimal string");
  }
  if (typeof raw.public_key !== "string" || !EDPK.test(raw.public_key)) {
    throw new RelayerError("INTERNAL", `signature ${raw.index} public_key is not a valid edpk`);
  }
  if (typeof raw.signature !== "string" || !SIG.test(raw.signature)) {
    throw new RelayerError("SIGNATURE", `signature ${raw.index} is not a Tezos signature string`);
  }
  return { index: raw.index, public_key: raw.public_key, signature: raw.signature };
}

export function parseSignedBatch(raw: unknown): SignedBatch {
  assertNoOracleSigningKeys(raw, "signed batch");
  if (!isObject(raw)) {
    throw new RelayerError("INTERNAL", "signed batch must be an object");
  }
  const extra = extraKeys(raw, BATCH_KEYS);
  if (extra.length > 0) {
    throw new RelayerError("INTERNAL", `unknown batch field(s) ${extra.join(", ")}`);
  }
  if (raw.domain !== SIGNED_BATCH_DOMAIN) {
    throw new RelayerError("INTERNAL", `domain must be ${SIGNED_BATCH_DOMAIN}`);
  }
  if (typeof raw.packed_hex !== "string" || !HEX.test(raw.packed_hex) || !raw.packed_hex.startsWith("05")) {
    throw new RelayerError("PACKED_MISMATCH", "packed_hex must be lowercase 0x05-prefixed hex");
  }
  if (!Array.isArray(raw.signatures)) {
    throw new RelayerError("QUORUM", "signatures must be an array");
  }
  const payload = parseLogicalPayload(raw.payload);
  const signatures = raw.signatures.map(parseSignature);
  return { domain: SIGNED_BATCH_DOMAIN, payload, packed_hex: raw.packed_hex, signatures };
}

export function freezePackedHex(payload: LogicalPayload): string {
  return packPayload(payload).packedHex;
}

export function assertPackedBytesFrozen(payload: LogicalPayload, packedHex: string): string {
  const actual = freezePackedHex(payload);
  if (actual !== packedHex) {
    throw new RelayerError("PACKED_MISMATCH", "packed_hex does not match PACK(payload); relayer must not mutate signed bytes");
  }
  return actual;
}

export function sortSignatures(signatures: BatchSignature[]): BatchSignature[] {
  return [...signatures].sort((left, right) => {
    const delta = BigInt(left.index) - BigInt(right.index);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  });
}

export function submitMicheline(payload: LogicalPayload, signatures: BatchSignature[]): Micheline {
  const ordered = sortSignatures(signatures);
  return {
    prim: "Pair",
    args: [
      payloadMicheline(payload),
      ordered.map((entry) => ({
        prim: "Pair",
        args: [{ int: entry.index }, { string: entry.signature }],
      })),
    ],
  };
}

export function submitCallFromBatch(batch: SignedBatch): SubmitCall {
  const packed_hex = assertPackedBytesFrozen(batch.payload, batch.packed_hex);
  return {
    oracle_address: batch.payload.oracle_address,
    entrypoint: "submit",
    parameter: submitMicheline(batch.payload, batch.signatures),
    packed_hex,
    batch,
  };
}

export function signedBatchFromParts(args: {
  payload: LogicalPayload;
  packed_hex: string;
  signatures: BatchSignature[];
}): SignedBatch {
  assertPackedBytesFrozen(args.payload, args.packed_hex);
  return {
    domain: SIGNED_BATCH_DOMAIN,
    payload: args.payload,
    packed_hex: args.packed_hex,
    signatures: sortSignatures(args.signatures),
  };
}
