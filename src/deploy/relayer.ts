import { parseSignedBatch } from "../relayer/batch.js";
import { RelayerError } from "../relayer/errors.js";
import { assertNoOracleSigningKeys } from "../relayer/keys.js";
import { relaySignedBatch } from "../relayer/relay.js";
import { createHttpRelayRpc } from "../relayer/rpc.js";
import { parseSignerSet } from "../relayer/signers.js";
import type { RelayRpc } from "../relayer/types.js";
import { verifySignedBatch } from "../relayer/verify.js";
import { assertRelayerRuntime } from "./env.js";
import { unwrapEvent } from "./event.js";

export type RelayerDeps = {
  rpc?: RelayRpc;
};

export type HandlerResult = Record<string, unknown>;

function fail(error: unknown): HandlerResult {
  const code = error instanceof RelayerError ? error.code : "INTERNAL";
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, error_code: code, detail };
}

function loadInputs(body: Record<string, unknown>) {
  if (body.batch === undefined || body.signers === undefined) {
    throw new RelayerError("INTERNAL", "batch and signers are required");
  }
  assertNoOracleSigningKeys(body.batch, "relayer batch");
  assertNoOracleSigningKeys(body.signers, "relayer signer set");
  return { batch: parseSignedBatch(body.batch), signerSet: parseSignerSet(body.signers) };
}

function resolveRpc(deps: RelayerDeps): RelayRpc {
  if (deps.rpc) return deps.rpc;
  return createHttpRelayRpc({ rpcUrl: process.env.TEZOS_RPC_URL ?? "" });
}

export function createRelayerHandlers(deps: RelayerDeps = {}) {
  return {
    async verify(event: unknown): Promise<HandlerResult> {
      try {
        assertRelayerRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "relayer verify");
        const { batch, signerSet } = loadInputs(body);
        const verified = verifySignedBatch(batch, signerSet);
        if (!verified.ok) {
          return { ok: false, error_code: verified.code, detail: verified.detail };
        }
        return { ok: true, packed_hex: verified.packed_hex, signature_count: batch.signatures.length };
      } catch (error) {
        return fail(error);
      }
    },

    async submit(event: unknown): Promise<HandlerResult> {
      try {
        assertRelayerRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "relayer submit");
        const { batch, signerSet } = loadInputs(body);
        const result = await relaySignedBatch({ batch, signerSet, rpc: resolveRpc(deps) });
        if (!result.ok) {
          return { ok: false, error_code: result.code, detail: result.detail, packed_hex: result.packed_hex };
        }
        return { ok: true, packed_hex: result.packed_hex, op_hash: result.op_hash, confirmed: true };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

const handlers = createRelayerHandlers();

export const verify = handlers.verify;
export const submit = handlers.submit;
