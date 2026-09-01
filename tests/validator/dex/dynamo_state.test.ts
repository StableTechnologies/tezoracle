import assert from "node:assert/strict";
import test from "node:test";

import {
  createDynamoPoolSampleStore,
  createDynamoRoundStateStore,
  type DynamoDocClient,
} from "../../../src/validator/adapters/dex/dynamo_state.js";

function mockDocClient(): DynamoDocClient & { items: Map<string, Record<string, unknown>> } {
  const items = new Map<string, Record<string, unknown>>();
  return {
    items,
    async get({ Key }) {
      const id = Key.id as string;
      const item = items.get(id);
      return { Item: item };
    },
    async put({ Item }) {
      items.set(Item.id as string, Item);
    },
  };
}

test("pool sample store round-trips through a DynamoDB item", async () => {
  const client = mockDocClient();
  const store = createDynamoPoolSampleStore({ client, tableName: "PoolSamples", itemId: "USDTZ" });
  assert.deepEqual(await store.load(), {});
  await store.save({
    KT1Pool: [{ xtz_reserve: "1", token_reserve: "1", timestamp: 100 }],
  });
  const reloaded = await store.load();
  assert.deepEqual(reloaded, { KT1Pool: [{ xtz_reserve: "1", token_reserve: "1", timestamp: 100 }] });
  const stored = client.items.get("USDTZ");
  assert.equal(typeof stored?.data, "string");
  assert.equal(typeof stored?.ttl, "number");
});

test("pool sample store isolates items by itemId", async () => {
  const client = mockDocClient();
  const usdtzStore = createDynamoPoolSampleStore({ client, tableName: "PoolSamples", itemId: "USDTZ" });
  const tzbtcStore = createDynamoPoolSampleStore({ client, tableName: "PoolSamples", itemId: "TZBTC" });
  await usdtzStore.save({ KT1A: [{ xtz_reserve: "1", token_reserve: "1", timestamp: 1 }] });
  await tzbtcStore.save({ KT1B: [{ xtz_reserve: "2", token_reserve: "2", timestamp: 2 }] });
  assert.deepEqual(await usdtzStore.load(), { KT1A: [{ xtz_reserve: "1", token_reserve: "1", timestamp: 1 }] });
  assert.deepEqual(await tzbtcStore.load(), { KT1B: [{ xtz_reserve: "2", token_reserve: "2", timestamp: 2 }] });
});

test("round state store round-trips without a ttl attribute", async () => {
  const client = mockDocClient();
  const store = createDynamoRoundStateStore({ client, tableName: "RoundState", itemId: "signer" });
  assert.deepEqual(await store.load(), {});
  await store.save({ CORE: "5" });
  assert.deepEqual(await store.load(), { CORE: "5" });
  const stored = client.items.get("signer");
  assert.equal("ttl" in (stored ?? {}), false);
});

test("load fails closed (empty) on a malformed stored blob", async () => {
  const client = mockDocClient();
  client.items.set("bad", { id: "bad", data: "not json" });
  const store = createDynamoPoolSampleStore({ client, tableName: "PoolSamples", itemId: "bad" });
  assert.deepEqual(await store.load(), {});
});
