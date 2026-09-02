import type { DexPool } from "../../../config/validate.js";
import { ValidatorError } from "../../errors.js";
import type { PoolRpcClient } from "./rpc.js";
import { failSample, okSample, type PoolSampleResult } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireDigits(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new ValidatorError("MALFORMED", `${what} must be a non-negative decimal digit string`);
  }
  return BigInt(value);
}

const RESERVE_FIELDS: Record<
  DexPool["protocol"],
  { xtz: string; token: string; tokenAddress: string; nestedUnder?: string }
> = {
  // QuipuSwap V1's real Michelson storage has a top-level %storage field
  // annotation wrapping the pool record (sibling to %metadata/%dex_lambdas/
  // %token_lambdas bigmap ids) -- verified via TzKT 2026-09-01.
  quipuswap_v1_amm: { xtz: "tez_pool", token: "token_pool", tokenAddress: "token_address", nestedUnder: "storage" },
  dexter_v1_amm: { xtz: "xtzPool", token: "tokenPool", tokenAddress: "tokenAddress" },
};

export async function fetchConstantProductSample(
  pool: DexPool,
  rpc: PoolRpcClient,
  now: number,
): Promise<PoolSampleResult> {
  const fields = RESERVE_FIELDS[pool.protocol];
  if (!fields) {
    return failSample("INTERNAL", `no constant-product field map for protocol ${pool.protocol}`);
  }
  try {
    const storageRaw = await rpc.getStorage(pool.pool_address);
    if (!isObject(storageRaw)) {
      return failSample("MALFORMED", "pool storage must be an object");
    }
    let record = storageRaw;
    if (fields.nestedUnder) {
      const nested = storageRaw[fields.nestedUnder];
      if (!isObject(nested)) {
        return failSample("MALFORMED", `pool storage.${fields.nestedUnder} must be an object`);
      }
      record = nested;
    }
    const tokenAddress = record[fields.tokenAddress];
    if (tokenAddress !== pool.token_a_address) {
      return failSample("WRONG_MARKET", "pool token identity does not match the pinned register");
    }
    const xtzReserve = requireDigits(record[fields.xtz], `storage.${fields.xtz}`);
    const tokenReserve = requireDigits(record[fields.token], `storage.${fields.token}`);
    if (tokenReserve === 0n) {
      return failSample("DEX_LIQUIDITY", "token reserve is zero");
    }
    return okSample({
      pool_address: pool.pool_address,
      protocol: pool.protocol,
      xtz_reserve: xtzReserve,
      token_reserve: tokenReserve,
      timestamp: now,
    });
  } catch (error) {
    if (error instanceof ValidatorError) {
      return failSample(error.code, error.message);
    }
    return failSample("INTERNAL", "constant-product sample fetch failed");
  }
}
