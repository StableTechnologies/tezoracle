import { verifySignature } from "@taquito/utils";

import { packPayload } from "../packing/pack.js";
import { signedBatchFromParts } from "../relayer/batch.js";
import type { SignerRecord, SignerSet } from "../relayer/types.js";
import type { CandidateDocument } from "../validator/types.js";
import { CoordinatorError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import {
  COLLECTION_DOMAIN,
  type CollectionState,
  type IncomingSignature,
  type RoundRequest,
  type SealResult,
} from "./types.js";

function requireSigner(set: SignerSet, index: string): SignerRecord {
  const signer = set.signers.find((entry) => entry.index === index);
  if (!signer) {
    throw new CoordinatorError("UNKNOWN_SIGNER", `index ${index} is not in the signer set`);
  }
  if (!signer.active) {
    throw new CoordinatorError("INACTIVE_SIGNER", `index ${index} is inactive`);
  }
  return signer;
}

function isTimedOut(state: CollectionState, now: number): boolean {
  return BigInt(now) > BigInt(state.request.collect_until);
}

function signatureCountMeetsQuorum(state: CollectionState): boolean {
  if (state.signatures.length < state.signer_set.threshold_n) return false;
  const classCounts: Record<string, number> = {};
  for (const entry of state.signatures) {
    const signer = requireSigner(state.signer_set, entry.index);
    classCounts[signer.class_id] = (classCounts[signer.class_id] ?? 0) + 1;
  }
  for (const [classId, minimum] of Object.entries(state.signer_set.class_minima)) {
    if ((classCounts[classId] ?? 0) < minimum) return false;
  }
  return true;
}

export function openCollection(args: {
  request: RoundRequest;
  candidate: CandidateDocument;
  packed_hex: string;
  signerSet: SignerSet;
}): CollectionState {
  assertNoOracleSigningKeys({ request: args.request, candidate: args.candidate }, "open collection");
  const packed = packPayload(args.candidate.payload).packedHex;
  if (packed !== args.packed_hex) {
    throw new CoordinatorError("PACKED_MISMATCH", "collection packed_hex does not match PACK(candidate.payload)");
  }
  if (args.candidate.payload.round !== args.request.round) {
    throw new CoordinatorError("INTERNAL", "candidate round does not match the round request");
  }
  if (args.candidate.payload.publication_group !== args.request.publication_group) {
    throw new CoordinatorError("INTERNAL", "candidate group does not match the round request");
  }
  if (args.candidate.payload.policy_hash !== args.request.policy_hash) {
    throw new CoordinatorError("POLICY_PIN", "candidate policy_hash does not match the pinned request hash");
  }
  return {
    domain: COLLECTION_DOMAIN,
    request: args.request,
    candidate: args.candidate,
    packed_hex: packed,
    signatures: [],
    status: "open",
    signer_set: args.signerSet,
  };
}

export function parseIncomingSignature(raw: unknown, index?: string): IncomingSignature {
  assertNoOracleSigningKeys(raw, "incoming signature");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CoordinatorError("INTERNAL", "signature document must be an object");
  }
  const body = raw as Record<string, unknown>;
  const resolvedIndex = index ?? (typeof body.index === "string" ? body.index : undefined);
  if (resolvedIndex === undefined) {
    throw new CoordinatorError("UNKNOWN_SIGNER", "signature index is required");
  }
  const public_key = typeof body.public_key === "string" ? body.public_key : undefined;
  const packed_hex = typeof body.packed_hex === "string" ? body.packed_hex : undefined;
  let signature: string | undefined;
  if (typeof body.signature === "string") {
    signature = body.signature;
  } else if (typeof body.signature === "object" && body.signature !== null && !Array.isArray(body.signature)) {
    const nested = body.signature as Record<string, unknown>;
    if (typeof nested.edsig === "string") signature = nested.edsig;
    else if (typeof nested.sig === "string") signature = nested.sig;
  }
  if (!public_key || !packed_hex || !signature) {
    throw new CoordinatorError("SIGNATURE", "signature document must include public_key, packed_hex, and signature");
  }
  return { index: resolvedIndex, public_key, signature, packed_hex };
}

export function collectSignature(state: CollectionState, incoming: IncomingSignature, now: number): CollectionState {
  assertNoOracleSigningKeys(incoming, "collected signature");
  if (state.status !== "open") {
    throw new CoordinatorError("INTERNAL", `collection is ${state.status} and is not accepting signatures`);
  }
  if (isTimedOut(state, now)) {
    return { ...state, status: "timeout" };
  }
  if (incoming.packed_hex !== state.packed_hex) {
    throw new CoordinatorError("PACKED_MISMATCH", "signature packed_hex does not match the frozen candidate bytes");
  }
  if (incoming.payload !== undefined) {
    const packed = packPayload(incoming.payload).packedHex;
    if (packed !== state.packed_hex) {
      throw new CoordinatorError("PACKED_MISMATCH", "supplied payload does not match the frozen candidate bytes");
    }
  }
  const signer = requireSigner(state.signer_set, incoming.index);
  if (signer.public_key !== incoming.public_key) {
    throw new CoordinatorError("SIGNATURE", `public key for index ${incoming.index} does not match the signer set`);
  }
  if (state.signatures.some((entry) => entry.index === incoming.index)) {
    throw new CoordinatorError("DUPLICATE", `index ${incoming.index} already collected`);
  }
  let valid = false;
  try {
    valid = verifySignature(state.packed_hex, incoming.public_key, incoming.signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new CoordinatorError("SIGNATURE", `CHECK_SIGNATURE failed for index ${incoming.index}`);
  }
  const next: CollectionState = {
    ...state,
    signatures: [
      ...state.signatures,
      {
        index: incoming.index,
        public_key: incoming.public_key,
        signature: incoming.signature,
      },
    ],
  };
  if (signatureCountMeetsQuorum(next)) {
    next.status = "quorum";
  }
  return next;
}

export function sealCollection(state: CollectionState, now: number): SealResult {
  const packed_hex = packPayload(state.candidate.payload).packedHex;
  if (packed_hex !== state.packed_hex) {
    throw new CoordinatorError("PACKED_MISMATCH", "collection payload drifted from packed_hex");
  }
  if (signatureCountMeetsQuorum(state)) {
    const batch = signedBatchFromParts({
      payload: state.candidate.payload,
      packed_hex,
      signatures: state.signatures,
    });
    return { ok: true, status: "quorum", batch, packed_hex };
  }
  if (isTimedOut(state, now) || state.status === "timeout") {
    return {
      ok: false,
      status: "timeout",
      code: "TIMEOUT",
      detail: `collect_until ${state.request.collect_until} passed with ${state.signatures.length} of ${state.signer_set.threshold_n} signatures`,
      packed_hex,
      signature_count: state.signatures.length,
    };
  }
  if (state.status === "incomplete") {
    return {
      ok: false,
      status: "incomplete",
      code: "INCOMPLETE",
      detail: `collection closed with ${state.signatures.length} of ${state.signer_set.threshold_n} signatures`,
      packed_hex,
      signature_count: state.signatures.length,
    };
  }
  return {
    ok: false,
    status: "open",
    code: "QUORUM",
    detail: `collection still open; ${state.signatures.length} of ${state.signer_set.threshold_n} signatures`,
    packed_hex,
    signature_count: state.signatures.length,
  };
}

export function closeIncomplete(state: CollectionState): CollectionState {
  if (state.status === "quorum") return state;
  return { ...state, status: "incomplete" };
}
