/**
 * Canonical JSON preimage for policy_hash and evidence_digest.
 * Rules match docs/EVIDENCE_SPEC.md §4 and docs/PARAMETER_SCHEMA.md §7.
 */

import { blake2b } from "@noble/hashes/blake2.js";

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function blake2b256Hex(bytes: Uint8Array): string {
  return bytesToHex(blake2b(bytes, { dkLen: 32 }));
}

export function blake2b256Utf8(text: string): string {
  return blake2b256Hex(new TextEncoder().encode(text));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  const object = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    sorted[key] = sortValue(object[key]);
  }
  return sorted;
}
