import { verifySignature } from "@taquito/utils";

import { RelayerError } from "./errors.js";
import { submitCallFromBatch } from "./batch.js";
import { lookupSigner } from "./signers.js";
import type { SignedBatch, SignerSet, VerifyResult } from "./types.js";

export function verifySignedBatch(batch: SignedBatch, signerSet: SignerSet): VerifyResult {
  try {
    return { ok: true, ...verifySignedBatchOrThrow(batch, signerSet) };
  } catch (error) {
    if (error instanceof RelayerError) {
      return { ok: false, code: error.code, detail: error.message };
    }
    return { ok: false, code: "INTERNAL", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function verifySignedBatchOrThrow(batch: SignedBatch, signerSet: SignerSet): {
  batch: SignedBatch;
  packed_hex: string;
  call: ReturnType<typeof submitCallFromBatch>;
} {
  const call = submitCallFromBatch(batch);
  if (batch.signatures.length > 16) {
    throw new RelayerError("QUORUM", "more than 16 signatures");
  }
  if (batch.signatures.length < signerSet.threshold_n) {
    throw new RelayerError("QUORUM", `need ${signerSet.threshold_n} signatures, got ${batch.signatures.length}`);
  }
  const seen = new Set<string>();
  const classCounts: Record<string, number> = {};
  for (const entry of batch.signatures) {
    if (seen.has(entry.index)) {
      throw new RelayerError("DUPLICATE", `duplicate signer index ${entry.index}`);
    }
    seen.add(entry.index);
    const signer = lookupSigner(signerSet, entry.index);
    if (signer.public_key !== entry.public_key) {
      throw new RelayerError("SIGNATURE", `public key for index ${entry.index} does not match the signer set`);
    }
    let valid = false;
    try {
      valid = verifySignature(batch.packed_hex, entry.public_key, entry.signature);
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new RelayerError("SIGNATURE", `CHECK_SIGNATURE failed for index ${entry.index}`);
    }
    classCounts[signer.class_id] = (classCounts[signer.class_id] ?? 0) + 1;
  }
  for (const [classId, minimum] of Object.entries(signerSet.class_minima)) {
    if ((classCounts[classId] ?? 0) < minimum) {
      throw new RelayerError("CLASS_MIN", `class ${classId} needs ${minimum} signatures`);
    }
  }
  return { batch, packed_hex: call.packed_hex, call };
}
