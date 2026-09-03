import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { defaultHttpTransport, type HttpTransport } from "../validator/adapters/http.js";
import type { PoolRpcClient } from "../validator/adapters/dex/rpc.js";
import { createTzktPoolRpcClient } from "../validator/adapters/dex/tzkt_rpc.js";
import type { PoolSampleStore } from "../validator/adapters/dex/state.js";
import { verifyCandidate } from "../validator/candidate.js";
import { ValidatorError } from "../validator/errors.js";
import {
  loadGovernanceArtifact,
  loadGovernanceSidecar,
  signGovernanceArtifact,
  sidecarPathForVersion,
  type GovernanceArtifact,
  type GovernanceSidecar,
} from "../validator/governance.js";
import { defaultConfigDir, pinSnapshot } from "../validator/policy.js";
import {
  commitRound,
  loadRoundState,
  saveRoundState,
  signPackedPayload,
  type RoundStateStore,
} from "../validator/signer.js";
import { defaultDexStateStoreFor, defaultRoundStateStore } from "./dynamo.js";
import { SIGNER_SECRET_ENV, SIGNER_SECRET_NAME_ENV } from "./env.js";
import { unwrapEvent } from "./event.js";

export type SecretProvider = () => Promise<string>;

type SecretsManagerLike = {
  send(command: GetSecretValueCommand): Promise<{
    SecretString?: string;
    SecretBinary?: Uint8Array;
  }>;
};

export type SignerDeps = {
  transport?: HttpTransport;
  configDir?: string;
  now?: () => number;
  secretProvider?: SecretProvider;
  poolRpc?: PoolRpcClient;
  dexStateStoreFor?: (group: string) => PoolSampleStore | undefined;
  roundStateStore?: RoundStateStore;
  governanceArtifactProvider?: () => Promise<GovernanceArtifact>;
  governanceSidecarProvider?: () => Promise<GovernanceSidecar | undefined>;
  governanceChainId?: string;
  governanceOracleAddress?: string;
};

export type HandlerResult = Record<string, unknown>;

const GOVERNANCE_INTENT_PATH = "config/governance/intent.json";
const GOVERNANCE_MANIFEST_PATH = "config/governance/manifest.json";

type GovernanceDeploymentManifest = {
  schema_version: 1;
  intent_sha256: string;
};

export function createSecretsManagerSecretProvider(
  name: string,
  client: SecretsManagerLike = new SecretsManagerClient({}),
): SecretProvider {
  return async () => {
    const result = await client.send(new GetSecretValueCommand({ SecretId: name }));
    const secret =
      result.SecretString ??
      (result.SecretBinary ? Buffer.from(result.SecretBinary).toString("utf8") : undefined);
    if (!secret) {
      throw new ValidatorError("INTERNAL", "Secrets Manager returned an empty signer secret");
    }
    return secret;
  };
}

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
    return createSecretsManagerSecretProvider(name)();
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

function groupFromCandidate(candidate: unknown): string {
  if (typeof candidate !== "object" || candidate === null) return "CORE";
  const payload = (candidate as Record<string, unknown>).payload;
  if (typeof payload !== "object" || payload === null) return "CORE";
  const group = (payload as Record<string, unknown>).publication_group;
  return typeof group === "string" && group.length > 0 ? group : "CORE";
}

const ACTION_DOMAIN: Record<string, string> = {
  config: "TEZORACLE_CONFIG_V1",
  config_cancel: "TEZORACLE_CONFIG_CANCEL_V1",
  unpause: "TEZORACLE_UNPAUSE_V1",
  unpause_cancel: "TEZORACLE_UNPAUSE_CANCEL_V1",
  asset_unpause: "TEZORACLE_ASSET_UNPAUSE_V1",
  asset_unpause_cancel: "TEZORACLE_ASSET_UNPAUSE_CANCEL_V1",
};

function governanceDomain(artifact: GovernanceArtifact): string | undefined {
  if (typeof artifact.intent !== "object" || artifact.intent === null || Array.isArray(artifact.intent)) {
    return undefined;
  }
  const domain = (artifact.intent as Record<string, unknown>).domain;
  return typeof domain === "string" ? domain : undefined;
}

export function assertPinnedFileDigest(
  path: string,
  expectedSha256: string | undefined,
  label: string,
): void {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) {
    throw new ValidatorError("POLICY_PIN", `${label} SHA-256 pin is required`);
  }
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expectedSha256) {
    throw new ValidatorError("POLICY_PIN", `${label} SHA-256 differs from deployment pin`);
  }
}

function governanceDeploymentManifest(): GovernanceDeploymentManifest {
  const value = JSON.parse(readFileSync(GOVERNANCE_MANIFEST_PATH, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidatorError("POLICY_PIN", "governance manifest must be an object");
  }
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  if (
    keys.join(",") !== "intent_sha256,schema_version" ||
    raw.schema_version !== 1 ||
    typeof raw.intent_sha256 !== "string"
  ) {
    throw new ValidatorError("POLICY_PIN", "governance manifest is malformed");
  }
  return raw as GovernanceDeploymentManifest;
}

async function governanceArtifact(deps: SignerDeps): Promise<GovernanceArtifact> {
  if (deps.governanceArtifactProvider) return deps.governanceArtifactProvider();
  const manifest = governanceDeploymentManifest();
  assertPinnedFileDigest(
    GOVERNANCE_INTENT_PATH,
    manifest.intent_sha256,
    "governance intent",
  );
  return loadGovernanceArtifact(GOVERNANCE_INTENT_PATH);
}

async function governanceSidecar(
  deps: SignerDeps,
  configDir: string,
): Promise<GovernanceSidecar | undefined> {
  if (deps.governanceSidecarProvider) return deps.governanceSidecarProvider();
  const { snapshot } = pinSnapshot(configDir);
  return loadGovernanceSidecar(
    sidecarPathForVersion(configDir, snapshot.register.config_version),
  );
}

export function createSignerHandlers(deps: SignerDeps = {}) {
  const configDir = deps.configDir ?? process.env.TEZORACLE_CONFIG_DIR ?? defaultConfigDir();
  const transport = deps.transport ?? defaultHttpTransport;
  const clock = deps.now ?? ((): number => Math.floor(Date.now() / 1000));
  const poolRpc = deps.poolRpc ?? createTzktPoolRpcClient({ transport });
  const dexStateStoreFor = deps.dexStateStoreFor ?? defaultDexStateStoreFor;
  const roundStateStore = deps.roundStateStore ?? defaultRoundStateStore();

  return {
    async sign(event: unknown): Promise<HandlerResult> {
      try {
        const body = unwrapEvent(event);
        if (body.candidate === undefined) {
          throw new ValidatorError("POLICY_PIN", "candidate is required");
        }
        const { snapshot } = pinSnapshot(configDir);
        const now = nowFrom(body, clock);
        const verified = await verifyCandidate({
          snapshot,
          candidate: body.candidate,
          transport,
          now,
          poolRpc,
          dexStateStore: dexStateStoreFor(groupFromCandidate(body.candidate)),
        });
        if (!verified.ok) {
          return { ok: false, error_code: verified.code, detail: verified.detail };
        }
        const secret = await resolveSignerSecret(deps.secretProvider);
        const statePath =
          (typeof body.state_path === "string" ? body.state_path : undefined) ?? process.env.TEZORACLE_ROUND_STATE_PATH;
        const state = roundStateStore ? await roundStateStore.load() : loadRoundState(statePath);
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
        const nextState = commitRound(state, verified.payload.publication_group, verified.payload.round);
        if (roundStateStore) {
          await roundStateStore.save(nextState);
        } else if (statePath) {
          saveRoundState(statePath, nextState);
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
    async signGovernance(event: unknown): Promise<HandlerResult> {
      try {
        const body = unwrapEvent(event);
        const extra = Object.keys(body).filter(
          (key) => key !== "action" && key !== "index",
        );
        if (extra.length > 0) {
          throw new ValidatorError(
            "POLICY_PIN",
            `unknown governance event field(s): ${extra.join(", ")}`,
          );
        }
        if (typeof body.action !== "string" || ACTION_DOMAIN[body.action] === undefined) {
          throw new ValidatorError("POLICY_PIN", "a supported governance action is required");
        }
        if (body.index !== undefined && typeof body.index !== "string") {
          throw new ValidatorError("POLICY_PIN", "governance index must be a string");
        }
        const artifact = await governanceArtifact(deps);
        if (governanceDomain(artifact) !== ACTION_DOMAIN[body.action]) {
          throw new ValidatorError("POLICY_PIN", "action does not match signer-local intent domain");
        }
        const { snapshot } = pinSnapshot(configDir);
        const expectedChainId = deps.governanceChainId ?? process.env.TEZOS_CHAIN_ID;
        const expectedOracleAddress =
          deps.governanceOracleAddress ?? process.env.ORACLE_ADDRESS;
        if (!expectedChainId || !expectedOracleAddress) {
          throw new ValidatorError(
            "POLICY_PIN",
            "TEZOS_CHAIN_ID and ORACLE_ADDRESS are required for governance signing",
          );
        }
        const signed = await signGovernanceArtifact({
          artifact,
          snapshot,
          sidecar: await governanceSidecar(deps, configDir),
          secretKey: await resolveSignerSecret(deps.secretProvider),
          now: clock(),
          expectedChainId,
          expectedOracleAddress,
        });
        const index = typeof body.index === "string" ? body.index : "0";
        return {
          ok: true,
          index,
          intent: signed.intent,
          packed_hex: signed.packed_hex,
          blake2b_hex: signed.blake2b_hex,
          public_key: signed.public_key,
          signature: signed.signature.edsig,
        };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

const handlers = createSignerHandlers();

export const sign = handlers.sign;
export const signGovernance = handlers.signGovernance;
