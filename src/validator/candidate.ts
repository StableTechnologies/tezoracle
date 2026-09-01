import { parseLogicalPayload } from "../packing/validate.js";
import type { LogicalPayload } from "../packing/types.js";
import type { RegisterSnapshot } from "../config/validate.js";
import type { PoolRpcClient } from "./adapters/dex/rpc.js";
import type { HttpTransport } from "./adapters/http.js";
import { absDelta, exceedsBps } from "./decimal.js";
import { derivePublicationGroup } from "./derive.js";
import { bindManifestToPayload, bindManifestToRegister, evidenceDigestHex, parseSharedManifest } from "./evidence.js";
import { ValidatorError } from "./errors.js";
import type { RefusalCode } from "./errors.js";
import { policyHashHex } from "./policy.js";
import type { CandidateDocument, GroupDerivation, VerificationResult } from "./types.js";

const CANDIDATE_KEYS = ["evidence", "payload"] as const;
const POLICY_SHAPED = [
  "sources",
  "min_independent_observations",
  "max_source_deviation_bps",
  "max_set_deviation_bps",
  "max_signer_deviation_bps",
  "aggregation",
  "rounding_mode",
  "decimals",
  "max_observation_age_seconds",
  "absolute_min_price",
  "absolute_max_price",
  "dex",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function fail(code: RefusalCode, detail: string, local?: GroupDerivation): VerificationResult {
  return { ok: false, code, detail, local };
}

function looksLikePolicy(value: unknown): boolean {
  if (!isObject(value)) return false;
  return POLICY_SHAPED.some((key) => key in value);
}

export function parseCandidateDocument(raw: unknown): CandidateDocument {
  if (!isObject(raw)) {
    throw new ValidatorError("POLICY_PIN", "candidate must be an object");
  }
  const extra = extraKeys(raw, CANDIDATE_KEYS);
  if (extra.length > 0) {
    throw new ValidatorError("POLICY_PIN", `unknown candidate field(s) ${extra.join(", ")}`);
  }
  if (!("payload" in raw) || !("evidence" in raw)) {
    throw new ValidatorError("POLICY_PIN", "candidate must contain payload and evidence");
  }
  if (looksLikePolicy(raw) || looksLikePolicy(raw.payload)) {
    throw new ValidatorError("POLICY_PIN", "candidate must not carry policy fields");
  }
  const payload = parseLogicalPayload(raw.payload);
  const evidence = parseSharedManifest(raw.evidence);
  return { payload, evidence };
}

export async function verifyCandidate(args: {
  snapshot: RegisterSnapshot;
  candidate: unknown;
  transport: HttpTransport;
  now: number;
  poolRpc?: PoolRpcClient;
  dexStatePath?: string;
}): Promise<VerificationResult> {
  const policyHash = policyHashHex(args.snapshot);
  let document: CandidateDocument;
  try {
    document = parseCandidateDocument(args.candidate);
  } catch (error) {
    if (error instanceof ValidatorError) {
      return fail(error.code, error.message);
    }
    return fail("INTERNAL", "candidate parse failed");
  }

  const { payload, evidence } = document;
  if (payload.policy_hash !== policyHash) {
    return fail("POLICY_PIN", "payload policy_hash is not the pinned register hash");
  }
  if (payload.config_version !== String(args.snapshot.register.config_version)) {
    return fail("POLICY_PIN", "payload config_version is not the pinned register version");
  }

  const window = BigInt(payload.valid_until) - BigInt(payload.valid_from);
  if (window < 1n || window > BigInt(args.snapshot.register.time_policy.validity_window_seconds)) {
    return fail("POLICY_PIN", "validity window is outside the pinned time policy");
  }
  if (BigInt(args.now) < BigInt(payload.valid_from) || BigInt(args.now) > BigInt(payload.valid_until)) {
    return fail("POLICY_PIN", "local now is outside the candidate validity window");
  }

  const payloadBind = bindManifestToPayload(evidence, payload);
  if (payloadBind) return fail(payloadBind, "shared evidence does not bind the payload");
  const registerBind = bindManifestToRegister(evidence, args.snapshot, policyHash);
  if (registerBind) return fail(registerBind, "shared evidence does not bind the pinned register");

  let local: GroupDerivation;
  try {
    local = await derivePublicationGroup({
      snapshot: args.snapshot,
      group: payload.publication_group,
      transport: args.transport,
      now: args.now,
      round: payload.round,
      poolRpc: args.poolRpc,
      dexStatePath: args.dexStatePath,
    });
  } catch (error) {
    if (error instanceof ValidatorError) {
      return fail(error.code, error.message);
    }
    return fail("INTERNAL", "local derivation failed");
  }

  const deviation_bps_by_asset: Record<string, number> = {};
  for (const candidateAsset of payload.assets) {
    const derived = local.assets.find((asset) => asset.asset_id === candidateAsset.asset_id);
    const manifestAsset = evidence.assets.find((asset) => asset.asset_id === candidateAsset.asset_id);
    const policy = args.snapshot.assets[candidateAsset.asset_id];
    if (!derived || !manifestAsset || !policy) {
      return fail("EVIDENCE_GROUP", `missing local derivation for ${candidateAsset.asset_id}`, local);
    }
    const candidatePrice = BigInt(candidateAsset.price);
    const localPrice = derived.price;
    if (exceedsBps(absDelta(candidatePrice, localPrice), localPrice, BigInt(policy.max_signer_deviation_bps))) {
      return fail("EVIDENCE_LOCAL", `${candidateAsset.asset_id} exceeds max_signer_deviation_bps`, local);
    }
    const candidateTime = Number(candidateAsset.observation_time);
    if (candidateTime !== manifestAsset.observation_time) {
      return fail("EVIDENCE_TIME", `${candidateAsset.asset_id} observation_time disagrees with the manifest`, local);
    }
    if (candidateTime > derived.observation_time) {
      return fail("EVIDENCE_TIME", `${candidateAsset.asset_id} observation_time is newer than the local oldest time`, local);
    }
    const delta = absDelta(candidatePrice, localPrice);
    deviation_bps_by_asset[candidateAsset.asset_id] =
      localPrice === 0n ? 0 : Number((delta * 10000n) / localPrice);
  }

  return {
    ok: true,
    payload,
    evidence,
    evidence_digest: payload.evidence_digest,
    local,
    deviation_bps_by_asset,
  };
}

export function candidateFromDerivation(args: {
  derivation: GroupDerivation;
  chain_id: string;
  oracle_address: string;
  round: string;
  valid_from: string;
  valid_until: string;
}): CandidateDocument {
  const evidence = { ...args.derivation.evidence, round: args.round };
  const evidence_digest = evidenceDigestHex(evidence);
  const payload: LogicalPayload = {
    domain: "TEZORACLE_V1",
    chain_id: args.chain_id,
    oracle_address: args.oracle_address,
    config_version: String(args.derivation.config_version),
    policy_hash: args.derivation.policy_hash,
    publication_group: args.derivation.group,
    round: args.round,
    valid_from: args.valid_from,
    valid_until: args.valid_until,
    evidence_digest,
    assets: args.derivation.assets.map((asset) => ({
      asset_id: asset.asset_id,
      price: asset.price.toString(),
      decimals: String(asset.decimals),
      observation_time: String(asset.observation_time),
    })),
  };
  return { payload, evidence };
}
