import { TICK_CADENCE_SECONDS } from "./types.js";
import type { TickResult } from "./types.js";

export type TickClock = {
  now(): number;
};

/**
 * Local driver: run the shared tick, then wait `cadenceSeconds` (default 300).
 * Clock and sleep are injected so tests do not wait wall-clock minutes.
 */
export async function runTickLoop(args: {
  tick: () => Promise<TickResult>;
  cadenceSeconds?: number;
  clock: TickClock;
  sleep: (seconds: number) => Promise<void>;
  shouldContinue: () => boolean;
  onResult?: (result: TickResult) => void | Promise<void>;
}): Promise<TickResult[]> {
  const cadence = args.cadenceSeconds ?? TICK_CADENCE_SECONDS;
  const results: TickResult[] = [];
  while (args.shouldContinue()) {
    const result = await args.tick();
    results.push(result);
    await args.onResult?.(result);
    if (!args.shouldContinue()) break;
    await args.sleep(cadence);
  }
  return results;
}

/**
 * Local setInterval driver. `schedule` is injectable; default is `setInterval`.
 */
export function startTickInterval(args: {
  tick: () => Promise<TickResult>;
  cadenceSeconds?: number;
  onResult?: (result: TickResult) => void;
  schedule?: (fn: () => void, ms: number) => { stop(): void };
}): { stop(): void } {
  const cadenceMs = (args.cadenceSeconds ?? TICK_CADENCE_SECONDS) * 1000;
  let stopped = false;
  let inFlight = false;

  const fire = (): void => {
    if (stopped || inFlight) return;
    inFlight = true;
    void args.tick().then((result) => {
      inFlight = false;
      if (!stopped) args.onResult?.(result);
    });
  };

  const schedule =
    args.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setInterval(fn, ms);
      return { stop: () => clearInterval(id) };
    });

  fire();
  const handle = schedule(fire, cadenceMs);
  return {
    stop() {
      stopped = true;
      handle.stop();
    },
  };
}
