import type { DexPool } from "../../../config/validate.js";
import type { RefusalCode } from "../../errors.js";

export type PoolSpotSample = {
  pool_address: string;
  protocol: DexPool["protocol"];
  /** Raw reserve of the non-USDtz leg (e.g. mutez for a native-XTZ pool). */
  xtz_reserve: bigint;
  /** Raw reserve of the USDtz leg. */
  token_reserve: bigint;
  /** When this sample was taken (validator's injected `now`, not on-chain). */
  timestamp: number;
};

export type PoolSampleOk = { ok: true; sample: PoolSpotSample };
export type PoolSampleFail = { ok: false; code: RefusalCode; detail: string };
export type PoolSampleResult = PoolSampleOk | PoolSampleFail;

export function failSample(code: RefusalCode, detail: string): PoolSampleFail {
  return { ok: false, code, detail };
}

export function okSample(sample: PoolSpotSample): PoolSampleOk {
  return { ok: true, sample };
}

