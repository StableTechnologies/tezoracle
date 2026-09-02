import { HttpError, type HttpTransport } from "../http.js";
import { ValidatorError } from "../../errors.js";
import type { PoolRpcClient } from "./rpc.js";

const DEFAULT_BASE_URL = "https://api.tzkt.io/v1";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 65_536;

export type TzktPoolRpcOptions = {
  transport: HttpTransport;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads pool storage from TzKT's indexer, which already decodes Micheline
 * into plain JSON keyed by field annotation (e.g. "tez_pool", "token_pool"),
 * matching the shapes the constant-product adapter expects. This avoids
 * decoding raw Micheline against a live node.
 */
export function createTzktPoolRpcClient(options: TzktPoolRpcOptions): PoolRpcClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeout_ms = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const max_response_bytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  async function getJson(url: string): Promise<unknown> {
    const response = await options.transport({ url, method: "GET", timeout_ms, max_response_bytes }).catch((error) => {
      if (error instanceof HttpError) throw new ValidatorError(error.code, error.message);
      throw error;
    });
    if (new URL(response.finalUrl).host !== new URL(url).host) {
      throw new ValidatorError("MALFORMED", "redirect changed host");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ValidatorError("HTTP_STATUS", `HTTP ${response.status}`);
    }
    if (response.contentType.length > 0 && !/json/i.test(response.contentType)) {
      throw new ValidatorError("MALFORMED", "content-type is not JSON");
    }
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new ValidatorError("MALFORMED", "body is not JSON");
    }
  }

  return {
    async getStorage(poolAddress) {
      return getJson(`${baseUrl}/contracts/${poolAddress}/storage`);
    },
    async getBigMapValue(bigMapId, key) {
      const entry = await getJson(`${baseUrl}/bigmaps/${bigMapId}/keys/${encodeURIComponent(key)}`);
      return isRecord(entry) && "value" in entry ? entry.value : entry;
    },
  };
}
