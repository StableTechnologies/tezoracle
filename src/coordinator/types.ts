import type { CandidateDocument } from "../validator/types.js";
import type { LogicalPayload } from "../packing/types.js";
import type { BatchSignature, SignedBatch, SignerSet } from "../relayer/types.js";

export const ROUND_REQUEST_DOMAIN = "TEZORACLE_ROUND_V1" as const;
export const COLLECTION_DOMAIN = "TEZORACLE_COLLECTION_V1" as const;

export type CollectionStatus = "open" | "quorum" | "timeout" | "incomplete";

export type RoundRequest = {
  domain: typeof ROUND_REQUEST_DOMAIN;
  publication_group: string;
  round: string;
  chain_id: string;
  oracle_address: string;
  config_version: string;
  policy_hash: string;
  valid_from: string;
  valid_until: string;
  collect_until: string;
  created_at: number;
};

export type CollectedSignature = BatchSignature & {
  public_key_hash?: string;
};

export type CollectionState = {
  domain: typeof COLLECTION_DOMAIN;
  request: RoundRequest;
  candidate: CandidateDocument;
  packed_hex: string;
  signatures: CollectedSignature[];
  status: CollectionStatus;
  signer_set: SignerSet;
};

export type SealSuccess = {
  ok: true;
  status: "quorum";
  batch: SignedBatch;
  packed_hex: string;
};

export type SealFailure = {
  ok: false;
  status: "timeout" | "incomplete" | "open";
  code: "TIMEOUT" | "INCOMPLETE" | "QUORUM";
  detail: string;
  packed_hex: string;
  signature_count: number;
};

export type SealResult = SealSuccess | SealFailure;

export type IncomingSignature = {
  index: string;
  public_key: string;
  signature: string;
  packed_hex: string;
  payload?: LogicalPayload;
};
