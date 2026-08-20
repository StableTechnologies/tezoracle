import { packDataBytes } from "@taquito/michel-codec";
import { blake2b } from "@noble/hashes/blake2.js";

import { PAYLOAD_MICHELSON_TYPE, payloadMicheline } from "./michelson.js";
import type { LogicalPayload, Micheline } from "./types.js";
import { PackError } from "./types.js";
import { parseLogicalPayload } from "./validate.js";

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

export function blake2b256Hex(bytes: Uint8Array): string {
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
}

export type PackedPayload = {
  payload: LogicalPayload;
  micheline: Micheline;
  packedHex: string;
  packedBytes: Uint8Array;
  blake2bHex: string;
};

export function packPayload(input: unknown): PackedPayload {
  const payload = parseLogicalPayload(input);
  const micheline = payloadMicheline(payload);
  const packed = packDataBytes(micheline as never, PAYLOAD_MICHELSON_TYPE as never);
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
