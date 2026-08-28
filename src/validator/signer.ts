import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { InMemorySigner } from "@taquito/signer";

import { packPayload } from "../packing/pack.js";
import type { LogicalPayload, PublicationGroup } from "../packing/types.js";
import { ValidatorError } from "./errors.js";
import { softwareArtifactHash } from "./policy.js";
import type { SignedPayload, SignerLocalRecord, SourceObservation } from "./types.js";
import { SIGNER_EVIDENCE_DOMAIN, VALIDATOR_CLASS } from "./types.js";

export type RoundState = Partial<Record<PublicationGroup, string>>;

export function loadRoundState(path: string | undefined): RoundState {
  if (!path) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return raw as RoundState;
  } catch {
    return {};
  }
}

export function saveRoundState(path: string, state: RoundState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function assertFreshRound(state: RoundState, group: PublicationGroup, round: string): void {
  const last = state[group];
  if (last !== undefined && BigInt(round) <= BigInt(last)) {
    throw new ValidatorError("INTERNAL", `round ${round} is not greater than last signed ${last} for ${group}`);
  }
}

export function commitRound(state: RoundState, group: PublicationGroup, round: string): RoundState {
  return { ...state, [group]: round };
}

export function buildLocalRecord(args: {
  payloadHash: string;
  signerId: string;
  configVersion: number;
  policyHash: string;
  localPrices: Record<string, string>;
  localTimes: Record<string, number>;
  deviationBps: Record<string, number>;
  localSources: SourceObservation[];
  decision: "sign" | "refuse";
  errorCode: string | null;
  decidedAt: number;
}): SignerLocalRecord {
  return {
    domain: SIGNER_EVIDENCE_DOMAIN,
    payload_hash: args.payloadHash,
    signer_id: args.signerId,
    validator_class: VALIDATOR_CLASS,
    config_version: args.configVersion,
    policy_hash: args.policyHash,
    software_artifact_hash: softwareArtifactHash(),
    local_price_by_asset: args.localPrices,
    local_observation_time_by_asset: args.localTimes,
    candidate_deviation_bps_by_asset: args.deviationBps,
    local_sources: args.localSources,
    decision: args.decision,
    error_code: args.errorCode,
    decided_at: args.decidedAt,
  };
}

export async function signPackedPayload(args: {
  payload: LogicalPayload;
  secretKey: string;
  signerId: string;
  state: RoundState;
  now: number;
  localPrices?: Record<string, string>;
  localTimes?: Record<string, number>;
  deviationBps?: Record<string, number>;
  localSources?: SourceObservation[];
}): Promise<SignedPayload> {
  if (!args.secretKey.startsWith("edsk")) {
    throw new ValidatorError("INTERNAL", "testnet signer key must be an edsk secret");
  }
  assertFreshRound(args.state, args.payload.publication_group, args.payload.round);
  const packed = packPayload(args.payload);
  const signer = await InMemorySigner.fromSecretKey(args.secretKey);
  const signed = await signer.sign(packed.packedHex);
  const local_record = buildLocalRecord({
    payloadHash: packed.blake2bHex,
    signerId: args.signerId,
    configVersion: Number(args.payload.config_version),
    policyHash: args.payload.policy_hash,
    localPrices: args.localPrices ?? Object.fromEntries(args.payload.assets.map((asset) => [asset.asset_id, asset.price])),
    localTimes: args.localTimes ?? Object.fromEntries(args.payload.assets.map((asset) => [asset.asset_id, Number(asset.observation_time)])),
    deviationBps: args.deviationBps ?? Object.fromEntries(args.payload.assets.map((asset) => [asset.asset_id, 0])),
    localSources: args.localSources ?? [],
    decision: "sign",
    errorCode: null,
    decidedAt: args.now,
  });
  return {
    payload: packed.payload,
    packed_hex: packed.packedHex,
    blake2b_hex: packed.blake2bHex,
    signature: {
      sig: signed.sig,
      edsig: signed.prefixSig,
      sbytes: signed.sbytes,
    },
    public_key: await signer.publicKey(),
    public_key_hash: await signer.publicKeyHash(),
    local_record,
  };
}
