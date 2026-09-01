import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  createDynamoPoolSampleStore,
  createDynamoRoundStateStore,
  type DynamoDocClient,
} from "../validator/adapters/dex/dynamo_state.js";
import type { PoolSampleStore } from "../validator/adapters/dex/state.js";
import type { RoundStateStore } from "../validator/signer.js";
import { POOL_SAMPLES_TABLE_ENV, ROUND_STATE_TABLE_ENV } from "./env.js";

export function createAwsDynamoDocClient(region?: string): DynamoDocClient {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  return {
    async get(params) {
      const result = await client.send(new GetCommand(params));
      return { Item: result.Item };
    },
    async put(params) {
      await client.send(new PutCommand(params));
    },
  };
}

/**
 * `undefined` (no persistence, same as the CLI without --dex-state) unless
 * TEZORACLE_POOL_SAMPLES_TABLE is configured -- one item per publication
 * group, so USDTZ and TZBTC never share TWAP history.
 */
export function defaultDexStateStoreFor(group: string): PoolSampleStore | undefined {
  const tableName = process.env[POOL_SAMPLES_TABLE_ENV];
  if (!tableName) return undefined;
  return createDynamoPoolSampleStore({ client: createAwsDynamoDocClient(), tableName, itemId: group });
}

/** `undefined` unless TEZORACLE_ROUND_STATE_TABLE is configured -- one
 * shared item across all groups (RoundState is itself keyed by group). */
export function defaultRoundStateStore(): RoundStateStore | undefined {
  const tableName = process.env[ROUND_STATE_TABLE_ENV];
  if (!tableName) return undefined;
  return createDynamoRoundStateStore({ client: createAwsDynamoDocClient(), tableName, itemId: "signer" });
}

