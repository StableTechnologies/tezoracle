import { binanceAdapter } from "./binance.js";
import { coinbaseAdapter } from "./coinbase.js";
import { krakenAdapter } from "./kraken.js";
import { okxAdapter } from "./okx.js";
import type { SourceAdapter } from "./types.js";

const ADAPTERS: Record<string, SourceAdapter> = {
  binance: binanceAdapter,
  okx: okxAdapter,
  kraken: krakenAdapter,
  coinbase: coinbaseAdapter,
};

export const INITIAL_PHASE_SOURCE_IDS = ["binance", "okx", "kraken", "coinbase"] as const;

export function getAdapter(sourceId: string): SourceAdapter | undefined {
  return ADAPTERS[sourceId];
}

export function listAdapters(): SourceAdapter[] {
  return INITIAL_PHASE_SOURCE_IDS.map((id) => ADAPTERS[id]).filter((adapter): adapter is SourceAdapter => adapter !== undefined);
}
