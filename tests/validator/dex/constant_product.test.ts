import assert from "node:assert/strict";
import test from "node:test";

import type { DexPool } from "../../../src/config/validate.js";
import { fetchConstantProductSample } from "../../../src/validator/adapters/dex/constant_product.js";
import { createMockPoolRpcClient } from "../../../src/validator/adapters/dex/rpc.js";

const QUIPUSWAP_V1_POOL: DexPool = {
  pool_address: "KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb",
  protocol: "quipuswap_v1_amm",
  token_a_address: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
  token_a_id: null,
  token_a_decimals: 6,
  token_b_address: "XTZ",
  token_b_id: null,
  token_b_decimals: 6,
  expected_code_hash: "572234294",
};

const DEXTER_POOL: DexPool = {
  pool_address: "KT1Tr2eG3eVmPRbymrbU2UppUmKjFPXomGG9",
  protocol: "dexter_v1_amm",
  token_a_address: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
  token_a_id: null,
  token_a_decimals: 6,
  token_b_address: "XTZ",
  token_b_id: null,
  token_b_decimals: 6,
  expected_code_hash: "262032754",
};

// Real storage shapes fetched from TzKT 2026-09-01. QuipuSwap V1's storage
// wraps the pool record under a top-level %storage field annotation,
// sibling to %metadata/%dex_lambdas/%token_lambdas bigmap ids.
const QUIPUSWAP_V1_STORAGE = {
  storage: {
    veto: "0",
    tez_pool: "124232308202",
    token_pool: "32935110728",
    token_address: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
  },
  metadata: 1508,
  dex_lambdas: 1507,
  token_lambdas: 1514,
};

const DEXTER_STORAGE = {
  manager: "KT1B5VTw8ZSMnrjhy337CEvAm4tnT8Gu8Geu",
  xtzPool: "6905501606",
  tokenPool: "1829440178",
  tokenAddress: "KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9",
};

test("quipuswap_v1 sample matches the real on-chain storage shape", async () => {
  const rpc = createMockPoolRpcClient({ storage: { [QUIPUSWAP_V1_POOL.pool_address]: QUIPUSWAP_V1_STORAGE } });
  const result = await fetchConstantProductSample(QUIPUSWAP_V1_POOL, rpc, 1_756_000_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sample.xtz_reserve, 124_232_308_202n);
  assert.equal(result.sample.token_reserve, 32_935_110_728n);
  assert.equal(result.sample.timestamp, 1_756_000_000);
});

test("dexter sample matches the real on-chain storage shape", async () => {
  const rpc = createMockPoolRpcClient({ storage: { [DEXTER_POOL.pool_address]: DEXTER_STORAGE } });
  const result = await fetchConstantProductSample(DEXTER_POOL, rpc, 1_756_000_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sample.xtz_reserve, 6_905_501_606n);
  assert.equal(result.sample.token_reserve, 1_829_440_178n);
});

test("fails closed on a token identity mismatch", async () => {
  const badStorage = {
    ...QUIPUSWAP_V1_STORAGE,
    storage: { ...QUIPUSWAP_V1_STORAGE.storage, token_address: "KT1SomeOtherTokenXXXXXXXXXXXXXXXXXXXX" },
  };
  const rpc = createMockPoolRpcClient({ storage: { [QUIPUSWAP_V1_POOL.pool_address]: badStorage } });
  const result = await fetchConstantProductSample(QUIPUSWAP_V1_POOL, rpc, 0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "WRONG_MARKET");
});

test("fails closed on a zero token reserve", async () => {
  const badStorage = { ...QUIPUSWAP_V1_STORAGE, storage: { ...QUIPUSWAP_V1_STORAGE.storage, token_pool: "0" } };
  const rpc = createMockPoolRpcClient({ storage: { [QUIPUSWAP_V1_POOL.pool_address]: badStorage } });
  const result = await fetchConstantProductSample(QUIPUSWAP_V1_POOL, rpc, 0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DEX_LIQUIDITY");
});

test("fails closed on a malformed reserve field", async () => {
  const badStorage = { ...QUIPUSWAP_V1_STORAGE, storage: { ...QUIPUSWAP_V1_STORAGE.storage, tez_pool: "not-a-number" } };
  const rpc = createMockPoolRpcClient({ storage: { [QUIPUSWAP_V1_POOL.pool_address]: badStorage } });
  const result = await fetchConstantProductSample(QUIPUSWAP_V1_POOL, rpc, 0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "MALFORMED");
});

test("fails closed when quipuswap_v1 storage is missing its %storage wrapper", async () => {
  const rpc = createMockPoolRpcClient({ storage: { [QUIPUSWAP_V1_POOL.pool_address]: QUIPUSWAP_V1_STORAGE.storage } });
  const result = await fetchConstantProductSample(QUIPUSWAP_V1_POOL, rpc, 0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "MALFORMED");
});
