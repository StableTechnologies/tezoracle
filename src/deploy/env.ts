import { CoordinatorError } from "../coordinator/errors.js";
import { assertNoOracleSigningKeys as assertCoordinatorHoldsNoKeys } from "../coordinator/keys.js";
import { RelayerError } from "../relayer/errors.js";
import { assertNoOracleSigningKeys as assertRelayerHoldsNoKeys } from "../relayer/keys.js";

export const SIGNER_SECRET_ENV = "TEZORACLE_SIGNER_SECRET_KEY";
export const SIGNER_SECRET_NAME_ENV = "TEZORACLE_SIGNER_SECRET_NAME";
export const FEE_PAYER_SECRET_NAME_ENV = "TEZORACLE_FEE_PAYER_SECRET_NAME";

export const PLACEHOLDER_ENV = [
  "TEZOS_RPC_URL",
  "TEZOS_CHAIN_ID",
  "ORACLE_ADDRESS",
  "TEZOS_NETWORK",
] as const;

export type DomainEnv = {
  chain_id: string;
  oracle_address: string;
  network: string;
  rpcUrl: string;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Domain-separation and RPC placeholders. Same names as `.env.example`.
 * Missing chain/oracle is a hard error for coordinator trigger/candidate.
 */
export function readDomainEnv(event: Record<string, unknown> = {}): DomainEnv {
  const chain_id = stringField(event.chain_id) ?? process.env.TEZOS_CHAIN_ID;
  const oracle_address = stringField(event.oracle_address) ?? process.env.ORACLE_ADDRESS;
  const network = stringField(event.network) ?? process.env.TEZOS_NETWORK ?? "shadownet";
  const rpcUrl = stringField(event.rpc_url) ?? process.env.TEZOS_RPC_URL ?? "";
  if (!chain_id || !oracle_address) {
    throw new CoordinatorError("INTERNAL", "TEZOS_CHAIN_ID and ORACLE_ADDRESS are required");
  }
  return { chain_id, oracle_address, network, rpcUrl };
}

export function assertCoordinatorRuntime(env: NodeJS.ProcessEnv = process.env): void {
  if (env[SIGNER_SECRET_ENV]) {
    throw new CoordinatorError("HOLD_KEYS", "coordinator must not have TEZORACLE_SIGNER_SECRET_KEY in its environment");
  }
  assertCoordinatorHoldsNoKeys(
    {
      TEZOS_RPC_URL: env.TEZOS_RPC_URL,
      TEZOS_CHAIN_ID: env.TEZOS_CHAIN_ID,
      ORACLE_ADDRESS: env.ORACLE_ADDRESS,
      TEZOS_NETWORK: env.TEZOS_NETWORK,
      TEZORACLE_SIGNER_SECRET_NAME: env[SIGNER_SECRET_NAME_ENV],
    },
    "coordinator env",
  );
}

export function assertRelayerRuntime(env: NodeJS.ProcessEnv = process.env): void {
  if (env[SIGNER_SECRET_ENV]) {
    throw new RelayerError("HOLD_KEYS", "relayer must not have TEZORACLE_SIGNER_SECRET_KEY in its environment");
  }
  assertRelayerHoldsNoKeys(
    {
      TEZOS_RPC_URL: env.TEZOS_RPC_URL,
      TEZOS_CHAIN_ID: env.TEZOS_CHAIN_ID,
      ORACLE_ADDRESS: env.ORACLE_ADDRESS,
      TEZOS_NETWORK: env.TEZOS_NETWORK,
      TEZORACLE_FEE_PAYER_SECRET_NAME: env[FEE_PAYER_SECRET_NAME_ENV],
      TEZORACLE_SIGNER_SECRET_NAME: env[SIGNER_SECRET_NAME_ENV],
    },
    "relayer env",
  );
}

export function nowFromEvent(event: Record<string, unknown>, fallback = (): number => Math.floor(Date.now() / 1000)): number {
  if (event.now === undefined) return fallback();
  if (typeof event.now === "number" && Number.isInteger(event.now) && event.now > 0) return event.now;
  if (typeof event.now === "string" && /^[1-9][0-9]*$/.test(event.now)) return Number(event.now);
  throw new CoordinatorError("INTERNAL", "now must be a positive Unix-seconds integer");
}
