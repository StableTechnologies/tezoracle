/**
 * Shared publication tick. One function, two drivers (local loop / EventBridge).
 * Composes coordinator, Class A, and relayer. No new policy. Testnet/shadow only.
 */

export { TICK_CADENCE_SECONDS } from "./types.js";
export type {
  OracleView,
  PriceView,
  SignCandidate,
  SignedCandidate,
  TickDeps,
  TickFailure,
  TickResult,
  TickSkip,
  TickSuccess,
} from "./types.js";
export { runTick } from "./tick.js";
export { runTickLoop, startTickInterval, type TickClock } from "./loop.js";
export { createOracleHarness, type OracleHarness, type OracleHarnessOptions } from "./oracle.js";
