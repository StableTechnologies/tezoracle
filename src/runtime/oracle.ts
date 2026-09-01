import { DOMAIN } from "../packing/types.js";
import type {
  ConfirmResult,
  RelayRpc,
  SimulateResult,
  SubmitCall,
} from "../relayer/types.js";
import type { OracleView, PriceView } from "./types.js";

export type PendingQuote = {
  price: string;
  observation_time: number;
  round: string;
  accepted_level: number;
  activation_level: number;
};

export type ActiveQuote = {
  price: string;
  observation_time: number;
  round: string;
};

export type OracleHarnessOptions = {
  chain_id: string;
  oracle_address: string;
  activation_delay_levels?: number;
  level?: number;
  now?: number;
};

export type OracleHarness = RelayRpc &
  OracleView & {
    submitted: SubmitCall[];
    last_round: Record<string, string>;
    pending: Record<string, PendingQuote>;
    active: Record<string, ActiveQuote>;
    setPaused(value: boolean): void;
    setPendingConfig(value: boolean): void;
    setNow(unixSeconds: number): void;
    advanceLevel(n?: number): void;
  };

/**
 * In-memory contract harness for local e2e.
 * Models submit fail-closed codes used by the tick: PAUSED, POLICY (pending
 * governance), DOMAIN, ROUND, WINDOW, PENDING_OPEN. Does not weaken
 * activation_delay_levels. Not a live Tezos RPC.
 */
export function createOracleHarness(options: OracleHarnessOptions): OracleHarness {
  const activationDelay = options.activation_delay_levels ?? 1;
  let level = options.level ?? 1;
  let paused = false;
  let pendingConfig = false;
  let now = options.now ?? 0;
  let op = 0;
  const last_round: Record<string, string> = {};
  const pending: Record<string, PendingQuote> = {};
  const active: Record<string, ActiveQuote> = {};
  const submitted: SubmitCall[] = [];

  function maturePending(assetId: string): void {
    const quote = pending[assetId];
    if (!quote) return;
    if (level >= quote.activation_level) {
      active[assetId] = {
        price: quote.price,
        observation_time: quote.observation_time,
        round: quote.round,
      };
      delete pending[assetId];
    }
  }

  function checkSubmit(call: SubmitCall): string | undefined {
    if (paused) return "PAUSED";
    if (pendingConfig) return "POLICY";
    const payload = call.batch.payload;
    if (payload.domain !== DOMAIN) return "DOMAIN";
    if (payload.chain_id !== options.chain_id) return "CHAIN";
    if (payload.oracle_address !== options.oracle_address) return "ORACLE";
    const last = last_round[payload.publication_group];
    if (last !== undefined && BigInt(payload.round) <= BigInt(last)) return "ROUND";
    const validFrom = Number(payload.valid_from);
    const validUntil = Number(payload.valid_until);
    if (now > 0 && (now < validFrom || now > validUntil)) return "WINDOW";
    for (const asset of payload.assets) {
      const open = pending[asset.asset_id];
      if (open && level < open.activation_level) return "PENDING_OPEN";
    }
    return undefined;
  }

  function accept(call: SubmitCall): void {
    const payload = call.batch.payload;
    const activation_level = level + activationDelay;
    for (const asset of payload.assets) {
      maturePending(asset.asset_id);
      pending[asset.asset_id] = {
        price: asset.price,
        observation_time: Number(asset.observation_time),
        round: payload.round,
        accepted_level: level,
        activation_level,
      };
    }
    last_round[payload.publication_group] = payload.round;
    submitted.push(call);
  }

  const harness: OracleHarness = {
    submitted,
    last_round,
    pending,
    active,
    level() {
      return level;
    },
    paused() {
      return paused;
    },
    pendingConfig() {
      return pendingConfig;
    },
    lastRound(group) {
      return last_round[group];
    },
    immaturePending(assetIds) {
      return assetIds.some((id) => {
        const quote = pending[id];
        return quote !== undefined && level < quote.activation_level;
      });
    },
    getPrice(assetId) {
      if (paused) return { ok: false, code: "PAUSED", detail: "oracle is paused" };
      maturePending(assetId);
      const quote = active[assetId];
      if (!quote) return { ok: false, code: "NO_PRICE", detail: `${assetId} has no mature quote` };
      return { ok: true, price: quote.price, observation_time: quote.observation_time };
    },
    setPaused(value) {
      paused = value;
    },
    setPendingConfig(value) {
      pendingConfig = value;
    },
    setNow(unixSeconds) {
      now = unixSeconds;
    },
    advanceLevel(n = 1) {
      level += n;
    },
    async simulate(call) {
      const error = checkSubmit(call);
      if (error) return { ok: false, error } satisfies SimulateResult;
      return { ok: true, consumed_gas: "8000" };
    },
    async broadcast(call) {
      const error = checkSubmit(call);
      if (error) return { ok: false, error };
      accept(call);
      op += 1;
      return { ok: true, op_hash: `opE2e${String(op).padStart(4, "0")}` };
    },
    async confirm(opHash) {
      return { ok: true, op_hash: opHash, confirmed: true } satisfies ConfirmResult;
    },
  };
  return harness;
}
