import type { PoolSampleState, PoolSampleStore } from "./state.js";
import type { RoundState, RoundStateStore } from "../../signer.js";

export type DynamoDocClient = {
  get(params: { TableName: string; Key: Record<string, unknown> }): Promise<{ Item?: Record<string, unknown> }>;
  put(params: { TableName: string; Item: Record<string, unknown> }): Promise<void>;
};

// Safety-net garbage collection for abandoned items (e.g. a retired asset
// group) -- correctness pruning of stale TWAP samples already happens in
// recordSample() before save() is ever called.
const TTL_SECONDS = 7 * 24 * 60 * 60;

function ttlAttribute(): number {
  return Math.floor(Date.now() / 1000) + TTL_SECONDS;
}

export function createDynamoPoolSampleStore(args: {
  client: DynamoDocClient;
  tableName: string;
  itemId: string;
}): PoolSampleStore {
  return {
    async load(): Promise<PoolSampleState> {
      const result = await args.client.get({ TableName: args.tableName, Key: { id: args.itemId } });
      if (!result.Item || typeof result.Item.data !== "string") return {};
      try {
        const parsed = JSON.parse(result.Item.data) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
        return parsed as PoolSampleState;
      } catch {
        return {};
      }
    },
    async save(state: PoolSampleState): Promise<void> {
      await args.client.put({
        TableName: args.tableName,
        Item: { id: args.itemId, data: JSON.stringify(state), ttl: ttlAttribute() },
      });
    },
  };
}

export function createDynamoRoundStateStore(args: {
  client: DynamoDocClient;
  tableName: string;
  itemId: string;
}): RoundStateStore {
  // No TTL here: round state is a replay-protection guard, not a cache --
  // losing it must never silently re-open a round that was already signed.
  return {
    async load(): Promise<RoundState> {
      const result = await args.client.get({ TableName: args.tableName, Key: { id: args.itemId } });
      if (!result.Item || typeof result.Item.data !== "string") return {};
      try {
        const parsed = JSON.parse(result.Item.data) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
        return parsed as RoundState;
      } catch {
        return {};
      }
    },
    async save(state: RoundState): Promise<void> {
      await args.client.put({
        TableName: args.tableName,
        Item: { id: args.itemId, data: JSON.stringify(state) },
      });
    },
  };
}
