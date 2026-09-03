import { packDataBytes } from "@taquito/michel-codec";

import { blake2b256Hex, bytesToHex } from "../canonical.js";
import type { RegisterPolicy } from "../config/policy.js";
import { PAYLOAD_MICHELSON_TYPE, payloadMicheline } from "./michelson.js";
import type { LogicalPayload, Micheline, PackablePayload } from "./types.js";
import { PackError } from "./types.js";
import { parseLogicalPayload } from "./validate.js";

export { blake2b256Hex, bytesToHex };

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new PackError("PACK", "hex must be lowercase with even length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export type PackedPayload<T extends PackablePayload | object = PackablePayload> = {
  payload: T;
  micheline: Micheline;
  packedHex: string;
  packedBytes: Uint8Array;
  blake2bHex: string;
};

export function packMichelineWithType<T extends object>(
  payload: T,
  micheline: Micheline,
  michelsonType: Micheline,
): PackedPayload<T> {
  const packed = packDataBytes(micheline as never, michelsonType as never);
  const packedHex = packed.bytes.toLowerCase();
  if (!packedHex.startsWith("05")) {
    throw new PackError("PACK", "PACK output must start with the 0x05 tag");
  }
  const packedBytes = hexToBytes(packedHex);
  return {
    payload,
    micheline,
    packedHex,
    packedBytes,
    blake2bHex: blake2b256Hex(packedBytes),
  };
}

function packMicheline<T extends PackablePayload>(payload: T, micheline: Micheline): PackedPayload<T> {
  return packMichelineWithType(payload, micheline, PAYLOAD_MICHELSON_TYPE);
}

export function packPayload(input: unknown, policy?: RegisterPolicy): PackedPayload<LogicalPayload> {
  const payload = parseLogicalPayload(input, policy);
  return packMicheline(payload, payloadMicheline(payload));
}

/**
 * PACK without canonical validation. Tamper tests use this to prove that a
 * mutated signed field changes the bytes even when the packer would reject it.
 */
export function packUnchecked(payload: PackablePayload): PackedPayload<PackablePayload> {
  return packMicheline(payload, payloadMicheline(payload));
}
