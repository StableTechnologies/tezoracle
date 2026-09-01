import { ValidatorError } from "../../errors.js";

export type PoolRpcClient = {
  /** Top-level contract storage, already decoded from Micheline to plain JSON. */
  getStorage(poolAddress: string): Promise<unknown>;
  /** A single big_map entry value, decoded from Micheline to plain JSON. */
  getBigMapValue(bigMapId: number, key: string): Promise<unknown>;
};

export function createUninjectedPoolRpcClient(): PoolRpcClient {
  return {
    async getStorage() {
      throw new ValidatorError(
        "INTERNAL",
        "live Tezos RPC pool reading is injected by the deployment layer; this path is not a production endpoint",
      );
    },
    async getBigMapValue() {
      throw new ValidatorError(
        "INTERNAL",
        "live Tezos RPC pool reading is injected by the deployment layer; this path is not a production endpoint",
      );
    },
  };
}

export type MockPoolRpcOptions = {
  storage?: Record<string, unknown>;
  bigMapValues?: Record<string, unknown>;
};

export function createMockPoolRpcClient(options: MockPoolRpcOptions = {}): PoolRpcClient {
  return {
    async getStorage(poolAddress) {
      const value = options.storage?.[poolAddress];
      if (value === undefined) {
        throw new ValidatorError("INTERNAL", `no mock storage for ${poolAddress}`);
      }
      return value;
    },
    async getBigMapValue(bigMapId, key) {
      const value = options.bigMapValues?.[`${bigMapId}:${key}`];
      if (value === undefined) {
        throw new ValidatorError("INTERNAL", `no mock big_map value for ${bigMapId}:${key}`);
      }
      return value;
    },
  };
}
