import { RelayerError } from "./errors.js";
import type { BroadcastResult, ConfirmResult, RelayRpc, SimulateResult, SubmitCall } from "./types.js";

export type MockRpcOptions = {
  op_hash?: string;
  simulate?: SimulateResult | ((call: SubmitCall) => SimulateResult | Promise<SimulateResult>);
  broadcast?: BroadcastResult | ((call: SubmitCall) => BroadcastResult | Promise<BroadcastResult>);
  confirm?: ConfirmResult | ((opHash: string) => ConfirmResult | Promise<ConfirmResult>);
};

export type RecordingRpc = RelayRpc & {
  calls: SubmitCall[];
  simulates: SubmitCall[];
  broadcasts: SubmitCall[];
  confirms: string[];
};

function unwrap<T, A>(
  value: T | ((arg: A) => T | Promise<T>) | undefined,
  arg: A,
  fallback: T,
): Promise<T> {
  if (value === undefined) return Promise.resolve(fallback);
  if (typeof value === "function") return Promise.resolve((value as (arg: A) => T | Promise<T>)(arg));
  return Promise.resolve(value);
}

export function createMockRpc(options: MockRpcOptions = {}): RecordingRpc {
  const op_hash = options.op_hash ?? "opMockTezOracle0000000000000000000000000001";
  const calls: SubmitCall[] = [];
  const simulates: SubmitCall[] = [];
  const broadcasts: SubmitCall[] = [];
  const confirms: string[] = [];
  return {
    calls,
    simulates,
    broadcasts,
    confirms,
    async simulate(call) {
      calls.push(call);
      simulates.push(call);
      return unwrap(options.simulate, call, { ok: true, consumed_gas: "8000" });
    },
    async broadcast(call) {
      calls.push(call);
      broadcasts.push(call);
      return unwrap(options.broadcast, call, { ok: true, op_hash });
    },
    async confirm(hash) {
      confirms.push(hash);
      return unwrap(options.confirm, hash, { ok: true, op_hash: hash, confirmed: true });
    },
  };
}

export function createFailingSimulateRpc(error = "PAUSED"): RecordingRpc {
  return createMockRpc({ simulate: { ok: false, error } });
}

export function createFailingBroadcastRpc(error = "rpc unavailable"): RecordingRpc {
  return createMockRpc({ broadcast: { ok: false, error } });
}

/**
 * Live Tezos injection is supplied by the local e2e harness (octez mockup or
 * Ghostnet adapter). This module does not talk to a production RPC.
 */
export function createHttpRelayRpc(_args: { rpcUrl: string }): RelayRpc {
  throw new RelayerError(
    "INTERNAL",
    "live Tezos RPC adapters are supplied by local e2e; this path is not a production endpoint",
  );
}
