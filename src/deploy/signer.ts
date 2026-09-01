import { defaultHttpTransport, type HttpTransport } from "../validator/adapters/http.js";
import { verifyCandidate } from "../validator/candidate.js";
import { ValidatorError } from "../validator/errors.js";
import { defaultConfigDir, pinSnapshot } from "../validator/policy.js";
import { commitRound, loadRoundState, saveRoundState, signPackedPayload } from "../validator/signer.js";
import { SIGNER_SECRET_ENV, SIGNER_SECRET_NAME_ENV } from "./env.js";
import { unwrapEvent } from "./event.js";

export type SecretProvider = () => Promise<string>;

export type SignerDeps = {
  transport?: HttpTransport;
  configDir?: string;
  now?: () => number;
  secretProvider?: SecretProvider;
};

export type HandlerResult = Record<string, unknown>;

/**
 * Only the Class A signer process may resolve the oracle signing secret.
 * Coordinator and relayer Lambdas must not call this.
 *
 * Production-shaped wiring fetches Secrets Manager by
 * `TEZORACLE_SIGNER_SECRET_NAME`. Local/tests may inject `secretProvider`.
 * The raw `TEZORACLE_SIGNER_SECRET_KEY` is accepted only inside this process
 * as a last-resort local fallback — it must not appear in the Serverless env.
 */
export async function resolveSignerSecret(provider?: SecretProvider): Promise<string> {
  if (provider) return provider();
  const fromEnv = process.env[SIGNER_SECRET_ENV];
  if (fromEnv) return fromEnv;
  const name = process.env[SIGNER_SECRET_NAME_ENV];
  if (name) {
    throw new ValidatorError(
      "INTERNAL",
      "Secrets Manager fetch is injected at deploy time; this process has a secret name but no provider",
    );
  }
  throw new ValidatorError("INTERNAL", "TEZORACLE_SIGNER_SECRET_KEY is required to sign");
}

function fail(error: unknown): HandlerResult {
  const code = error instanceof ValidatorError ? error.code : "INTERNAL";
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, error_code: code, detail };
}

function nowFrom(event: Record<string, unknown>, clock: () => number): number {
  if (event.now === undefined) return clock();
  if (typeof event.now === "number" && Number.isInteger(event.now) && event.now > 0) return event.now;
  if (typeof event.now === "string" && /^[1-9][0-9]*$/.test(event.now)) return Number(event.now);
  throw new ValidatorError("BAD_TIMESTAMP", "now must be a positive Unix-seconds integer");
}

export function createSignerHandlers(deps: SignerDeps = {}) {
  const configDir = deps.configDir ?? process.env.TEZORACLE_CONFIG_DIR ?? defaultConfigDir();
  const transport = deps.transport ?? defaultHttpTransport;
  const clock = deps.now ?? ((): number => Math.floor(Date.now() / 1000));

  return {
    async sign(event: unknown): Promise<HandlerResult> {
      try {
        const body = unwrapEvent(event);
        if (body.candidate === undefined) {
          throw new ValidatorError("POLICY_PIN", "candidate is required");
        }
        const { snapshot } = pinSnapshot(configDir);
        const now = nowFrom(body, clock);
        const verified = await verifyCandidate({ snapshot, candidate: body.candidate, transport, now });
        if (!verified.ok) {
          return { ok: false, error_code: verified.code, detail: verified.detail };
        }
        const secret = await resolveSignerSecret(deps.secretProvider);
        const statePath =
          (typeof body.state_path === "string" ? body.state_path : undefined) ?? process.env.TEZORACLE_ROUND_STATE_PATH;
        const state = loadRoundState(statePath);
        const signed = await signPackedPayload({
          payload: verified.payload,
          secretKey: secret,
          signerId: process.env.TEZORACLE_SIGNER_ID ?? "class-a",
          state,
          now,
          localPrices: Object.fromEntries(verified.local.assets.map((asset) => [asset.asset_id, asset.price.toString()])),
          localTimes: Object.fromEntries(verified.local.assets.map((asset) => [asset.asset_id, asset.observation_time])),
          deviationBps: verified.deviation_bps_by_asset,
          localSources: verified.local.assets.flatMap((asset) => asset.sources),
        });
        if (statePath) {
          saveRoundState(statePath, commitRound(state, verified.payload.publication_group, verified.payload.round));
        }
        const index = typeof body.index === "string" ? body.index : "0";
        return {
          ok: true,
          index,
          packed_hex: signed.packed_hex,
          public_key: signed.public_key,
          signature: signed.signature.edsig,
          local_record: signed.local_record,
        };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

const handlers = createSignerHandlers();

export const sign = handlers.sign;
