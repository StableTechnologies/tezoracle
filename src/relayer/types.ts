import type { LogicalPayload, Micheline } from "../packing/types.js";

export const SIGNED_BATCH_DOMAIN = "TEZORACLE_SIGNED_BATCH_V1" as const;

export const MAX_SIGNERS = 16;

export type SignerRecord = {
  index: string;
  public_key: string;
  class_id: string;
  active: boolean;
};

export type SignerSet = {
  threshold_n: number;
  threshold_m: number;
  class_minima: Record<string, number>;
  signers: SignerRecord[];
};

export type BatchSignature = {
  index: string;
  public_key: string;
  signature: string;
};

export type SignedBatch = {
  domain: typeof SIGNED_BATCH_DOMAIN;
  payload: LogicalPayload;
  packed_hex: string;
  signatures: BatchSignature[];
};

export type SubmitCall = {
  oracle_address: string;
  entrypoint: "submit";
  parameter: Micheline;
  packed_hex: string;
  batch: SignedBatch;
};

export type SimulateResult = { ok: true; consumed_gas?: string } | { ok: false; error: string };
export type BroadcastResult = { ok: true; op_hash: string } | { ok: false; error: string };
export type ConfirmResult = { ok: true; op_hash: string; confirmed: true } | { ok: false; error: string };

export type RelayRpc = {
  simulate(call: SubmitCall): Promise<SimulateResult>;
  broadcast(call: SubmitCall): Promise<BroadcastResult>;
  confirm(opHash: string): Promise<ConfirmResult>;
};

export type VerifySuccess = {
  ok: true;
  batch: SignedBatch;
  packed_hex: string;
  call: SubmitCall;
};

export type VerifyFailure = {
  ok: false;
  code: string;
  detail: string;
};

export type VerifyResult = VerifySuccess | VerifyFailure;

export type RelaySuccess = {
  ok: true;
  packed_hex: string;
  op_hash: string;
  confirmed: true;
  call: SubmitCall;
};

export type RelayFailure = {
  ok: false;
  code: string;
  detail: string;
  packed_hex?: string;
};

export type RelayResult = RelaySuccess | RelayFailure;
