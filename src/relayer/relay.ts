import { RelayerError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import { parseSignedBatch } from "./batch.js";
import { verifySignedBatch, verifySignedBatchOrThrow } from "./verify.js";
import type { RelayResult, RelayRpc, SignedBatch, SignerSet, SubmitCall } from "./types.js";

export function encodeSubmit(batch: SignedBatch, signerSet: SignerSet): SubmitCall {
  assertNoOracleSigningKeys(batch, "relayer encode");
  return verifySignedBatchOrThrow(batch, signerSet).call;
}

export async function relaySignedBatch(args: {
  batch: SignedBatch | unknown;
  signerSet: SignerSet;
  rpc: RelayRpc;
}): Promise<RelayResult> {
  try {
    const batch = "domain" in (args.batch as object) && (args.batch as SignedBatch).domain === "TEZORACLE_SIGNED_BATCH_V1"
      ? (args.batch as SignedBatch)
      : parseSignedBatch(args.batch);
    assertNoOracleSigningKeys(batch, "relayer");
    const verified = verifySignedBatch(batch, args.signerSet);
    if (!verified.ok) {
      return { ok: false, code: verified.code, detail: verified.detail };
    }
    const { call, packed_hex } = verified;
    const simulated = await args.rpc.simulate(call);
    if (!simulated.ok) {
      return { ok: false, code: "SIMULATE", detail: simulated.error, packed_hex };
    }
    const broadcast = await args.rpc.broadcast(call);
    if (!broadcast.ok) {
      return { ok: false, code: "BROADCAST", detail: broadcast.error, packed_hex };
    }
    const confirmed = await args.rpc.confirm(broadcast.op_hash);
    if (!confirmed.ok) {
      return { ok: false, code: "CONFIRM", detail: confirmed.error, packed_hex };
    }
    return { ok: true, packed_hex, op_hash: confirmed.op_hash, confirmed: true, call };
  } catch (error) {
    if (error instanceof RelayerError) {
      return { ok: false, code: error.code, detail: error.message };
    }
    return { ok: false, code: "INTERNAL", detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Backup path: the same sealed bytes, a different RPC.
 * The relayer never asks the coordinator for a new price or policy.
 */
export async function relayBackup(args: {
  batch: SignedBatch;
  signerSet: SignerSet;
  primary?: RelayRpc;
  backup: RelayRpc;
}): Promise<RelayResult> {
  if (args.primary) {
    const first = await relaySignedBatch({ batch: args.batch, signerSet: args.signerSet, rpc: args.primary });
    if (first.ok) return first;
  }
  return relaySignedBatch({ batch: args.batch, signerSet: args.signerSet, rpc: args.backup });
}
