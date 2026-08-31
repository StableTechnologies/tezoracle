import { defaultHttpTransport, type HttpTransport } from "../validator/adapters/http.js";
import { defaultConfigDir } from "../validator/policy.js";
import { CoordinatorError } from "../coordinator/errors.js";
import { assertNoOracleSigningKeys } from "../coordinator/keys.js";
import { RelayerError } from "../relayer/errors.js";
import { parseSignerSet } from "../relayer/signers.js";
import type { RelayRpc, SignerSet } from "../relayer/types.js";
import { runTick } from "../runtime/tick.js";
import type { OracleView, SignCandidate, TickResult } from "../runtime/types.js";
import { assertCoordinatorRuntime, nowFromEvent, readDomainEnv } from "./env.js";
import { unwrapEvent } from "./event.js";

export type TickHandlerDeps = {
  transport?: HttpTransport;
  configDir?: string;
  now?: () => number;
  rpc?: RelayRpc;
  oracle?: OracleView;
  sign?: SignCandidate;
  signerSet?: SignerSet;
};

export type HandlerResult = Record<string, unknown>;

function fail(error: unknown): HandlerResult {
  const code =
    error instanceof CoordinatorError || error instanceof RelayerError ? error.code : "INTERNAL";
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, skipped: false, error_code: code, detail };
}

function asResult(result: TickResult): HandlerResult {
  return { ...result };
}

/**
 * AWS / local driver over `runTick`. This process is a coordinator: it must
 * not read `TEZORACLE_SIGNER_SECRET_KEY`. Class A is injected (`sign`).
 */
export function createTickHandler(deps: TickHandlerDeps = {}) {
  const configDir = deps.configDir ?? process.env.TEZORACLE_CONFIG_DIR ?? defaultConfigDir();
  const transport = deps.transport ?? defaultHttpTransport;
  const clock = deps.now ?? ((): number => Math.floor(Date.now() / 1000));

  return {
    async tick(event: unknown): Promise<HandlerResult> {
      try {
        assertCoordinatorRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "coordinator tick");
        const { chain_id, oracle_address } = readDomainEnv(body);
        if (!deps.sign) {
          throw new CoordinatorError(
            "INTERNAL",
            "Class A sign is injected; coordinator tick must not read the signer secret",
          );
        }
        if (!deps.oracle || !deps.rpc) {
          throw new CoordinatorError(
            "INTERNAL",
            "oracle view and RelayRpc are injected; this path is not a live Ghostnet endpoint",
          );
        }
        const signerSet = deps.signerSet ?? (body.signers !== undefined ? parseSignerSet(body.signers) : undefined);
        if (!signerSet) {
          throw new CoordinatorError("INTERNAL", "signer set is required");
        }
        const now = nowFromEvent(body, clock);
        const result = await runTick({
          configDir,
          transport,
          rpc: deps.rpc,
          oracle: deps.oracle,
          signerSet,
          sign: deps.sign,
          now: () => now,
          chain_id,
          oracle_address,
          group: typeof body.group === "string" && body.group.length > 0 ? body.group : "CORE",
          signerIndex: typeof body.index === "string" ? body.index : "0",
        });
        return asResult(result);
      } catch (error) {
        return fail(error);
      }
    },
  };
}

const handlers = createTickHandler();

export const tick = handlers.tick;
