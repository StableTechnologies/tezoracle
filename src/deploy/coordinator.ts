import { defaultHttpTransport, type HttpTransport } from "../validator/adapters/http.js";
import { defaultConfigDir } from "../validator/policy.js";
import { assembleCandidate } from "../coordinator/candidate.js";
import { closeIncomplete, collectSignature, openCollection, parseIncomingSignature, sealCollection } from "../coordinator/collect.js";
import { CoordinatorError } from "../coordinator/errors.js";
import { assertNoOracleSigningKeys } from "../coordinator/keys.js";
import { triggerRound } from "../coordinator/round.js";
import type { CollectionState } from "../coordinator/types.js";
import { parseSignerSet } from "../relayer/signers.js";
import { assertCoordinatorRuntime, nowFromEvent, readDomainEnv } from "./env.js";
import { unwrapEvent } from "./event.js";

export type CoordinatorDeps = {
  transport?: HttpTransport;
  configDir?: string;
  now?: () => number;
};

export type HandlerResult = Record<string, unknown>;

function fail(error: unknown): HandlerResult {
  const code = error instanceof CoordinatorError ? error.code : "INTERNAL";
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, error_code: code, detail };
}

function groupFrom(event: Record<string, unknown>): string {
  return typeof event.group === "string" && event.group.length > 0 ? event.group : "CORE";
}

function roundFrom(event: Record<string, unknown>): string {
  if (event.round === undefined) return "1";
  if (typeof event.round === "number" && Number.isInteger(event.round) && event.round > 0) return String(event.round);
  if (typeof event.round === "string" && event.round.length > 0) return event.round;
  throw new CoordinatorError("INTERNAL", "round must be a positive decimal string");
}

function loadState(raw: unknown): CollectionState {
  assertNoOracleSigningKeys(raw, "collection state");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CoordinatorError("INTERNAL", "collection state must be an object");
  }
  return raw as CollectionState;
}

export function createCoordinatorHandlers(deps: CoordinatorDeps = {}) {
  const configDir = deps.configDir ?? process.env.TEZORACLE_CONFIG_DIR ?? defaultConfigDir();
  const transport = deps.transport ?? defaultHttpTransport;
  const clock = deps.now ?? ((): number => Math.floor(Date.now() / 1000));

  return {
    async trigger(event: unknown): Promise<HandlerResult> {
      try {
        assertCoordinatorRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "coordinator trigger");
        const { chain_id, oracle_address } = readDomainEnv(body);
        const now = nowFromEvent(body, clock);
        const request = triggerRound({
          configDir,
          group: groupFrom(body),
          round: roundFrom(body),
          now,
          chain_id,
          oracle_address,
          collect_timeout_seconds:
            typeof body.collect_timeout_seconds === "number" ? body.collect_timeout_seconds : undefined,
        });
        return { ok: true, request };
      } catch (error) {
        return fail(error);
      }
    },

    async candidate(event: unknown): Promise<HandlerResult> {
      try {
        assertCoordinatorRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "coordinator candidate");
        const { chain_id, oracle_address } = readDomainEnv(body);
        const now = nowFromEvent(body, clock);
        const request = triggerRound({
          configDir,
          group: groupFrom(body),
          round: roundFrom(body),
          now,
          chain_id,
          oracle_address,
          collect_timeout_seconds:
            typeof body.collect_timeout_seconds === "number" ? body.collect_timeout_seconds : undefined,
        });
        const assembled = await assembleCandidate({ request, configDir, transport, now });
        const result: HandlerResult = {
          ok: true,
          request: assembled.request,
          payload: assembled.candidate.payload,
          evidence: assembled.candidate.evidence,
          packed_hex: assembled.packed_hex,
        };
        if (body.signers !== undefined) {
          const signerSet = parseSignerSet(body.signers);
          result.state = openCollection({
            request: assembled.request,
            candidate: assembled.candidate,
            packed_hex: assembled.packed_hex,
            signerSet,
          });
        }
        return result;
      } catch (error) {
        return fail(error);
      }
    },

    async collect(event: unknown): Promise<HandlerResult> {
      try {
        assertCoordinatorRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "coordinator collect");
        if (body.state === undefined || body.signature === undefined) {
          throw new CoordinatorError("INTERNAL", "state and signature are required");
        }
        const now = nowFromEvent(body, clock);
        const index = typeof body.index === "string" ? body.index : undefined;
        const next = collectSignature(loadState(body.state), parseIncomingSignature(body.signature, index), now);
        return {
          ok: true,
          status: next.status,
          signature_count: next.signatures.length,
          packed_hex: next.packed_hex,
          state: next,
        };
      } catch (error) {
        return fail(error);
      }
    },

    async assemble(event: unknown): Promise<HandlerResult> {
      try {
        assertCoordinatorRuntime();
        const body = unwrapEvent(event);
        assertNoOracleSigningKeys(body, "coordinator assemble");
        if (body.state === undefined) {
          throw new CoordinatorError("INTERNAL", "state is required");
        }
        const now = nowFromEvent(body, clock);
        let state = loadState(body.state);
        if (body.close === true) state = closeIncomplete(state);
        const sealed = sealCollection(state, now);
        if (sealed.ok) {
          return { ok: true, status: sealed.status, batch: sealed.batch, packed_hex: sealed.packed_hex };
        }
        return {
          ok: false,
          status: sealed.status,
          error_code: sealed.code,
          detail: sealed.detail,
          packed_hex: sealed.packed_hex,
          signature_count: sealed.signature_count,
        };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

const handlers = createCoordinatorHandlers();

export const trigger = handlers.trigger;
export const candidate = handlers.candidate;
export const collect = handlers.collect;
export const assemble = handlers.assemble;
