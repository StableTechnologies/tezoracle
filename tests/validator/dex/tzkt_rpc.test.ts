import assert from "node:assert/strict";
import test from "node:test";

import { createMockTransport } from "../../../src/validator/adapters/http.js";
import { createTzktPoolRpcClient } from "../../../src/validator/adapters/dex/tzkt_rpc.js";
import { ValidatorError } from "../../../src/validator/errors.js";

const POOL = "KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb";
const BASE_URL = "https://api.tzkt.io/v1";

test("getStorage returns the decoded JSON body from TzKT", async () => {
  const storage = { tez_pool: "124232308202", token_pool: "32935110728", token_address: "KT1x" };
  const transport = createMockTransport({
    [`${BASE_URL}/contracts/${POOL}/storage`]: { body: storage },
  });
  const rpc = createTzktPoolRpcClient({ transport });
  assert.deepEqual(await rpc.getStorage(POOL), storage);
});

test("getBigMapValue unwraps TzKT's {value} envelope", async () => {
  const transport = createMockTransport({
    [`${BASE_URL}/bigmaps/123/keys/abc`]: { body: { key: "abc", value: { balance: "42" } } },
  });
  const rpc = createTzktPoolRpcClient({ transport });
  assert.deepEqual(await rpc.getBigMapValue(123, "abc"), { balance: "42" });
});

test("non-2xx status fails closed as HTTP_STATUS", async () => {
  const transport = createMockTransport({
    [`${BASE_URL}/contracts/${POOL}/storage`]: { status: 404, body: { error: "not found" } },
  });
  const rpc = createTzktPoolRpcClient({ transport });
  await assert.rejects(
    () => rpc.getStorage(POOL),
    (error: unknown) => error instanceof ValidatorError && error.code === "HTTP_STATUS",
  );
});

test("non-JSON content-type fails closed as MALFORMED", async () => {
  const transport = createMockTransport({
    [`${BASE_URL}/contracts/${POOL}/storage`]: { body: "<html></html>", contentType: "text/html" },
  });
  const rpc = createTzktPoolRpcClient({ transport });
  await assert.rejects(
    () => rpc.getStorage(POOL),
    (error: unknown) => error instanceof ValidatorError && error.code === "MALFORMED",
  );
});

test("a redirect that changes host fails closed as MALFORMED", async () => {
  const transport = createMockTransport({
    [`${BASE_URL}/contracts/${POOL}/storage`]: { body: {}, finalUrl: "https://evil.example/x" },
  });
  const rpc = createTzktPoolRpcClient({ transport });
  await assert.rejects(
    () => rpc.getStorage(POOL),
    (error: unknown) => error instanceof ValidatorError && error.code === "MALFORMED",
  );
});
