import { readFileSync } from "node:fs";
import { join } from "node:path";

import { InMemorySigner } from "@taquito/signer";

import { hashPolicySnapshot } from "../config/policy.js";
import type { RegisterSnapshot } from "../config/validate.js";
import {
  packAssetIntent,
  packConfigIntent,
  packSimpleIntent,
} from "../packing/governance.js";
import {
  ASSET_GOVERNANCE_DOMAINS,
  CONFIG_DOMAIN,
  SIMPLE_GOVERNANCE_DOMAINS,
  type LogicalConfigIntent,
  type LogicalInit,
  type LogicalSigner,
} from "../packing/governance_types.js";
import type { PackedPayload } from "../packing/pack.js";
import { ValidatorError } from "./errors.js";

const NAT_STRING = /^(0|[1-9][0-9]*)$/;
const HEX = /^[0-9a-f]+$/;

const SIDECAR_KEYS = [
  "schema_version",
  "admin",
  "guardian",
  "threshold_n",
  "threshold_m",
  "signers",
  "class_minima",
] as const;

export type GovernanceSidecar = {
  schema_version: 1;
  admin: string;
  guardian: string;
  threshold_n: string;
  threshold_m: string;
  signers: Record<string, LogicalSigner>;
  class_minima: Record<string, string>;
};

export type GovernanceArtifact = {
  intent: unknown;
  packed_hex: string;
};

export type SignedGovernanceIntent = {
  intent: object;
  packed_hex: string;
  blake2b_hex: string;
  public_key: string;
  public_key_hash: string;
  signature: {
    sig: string;
    edsig: string;
    sbytes: string;
  };
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidatorError("POLICY_PIN", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[], label: string): void {
  const extra = Object.keys(raw).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in raw));
  if (extra.length > 0 || missing.length > 0) {
    throw new ValidatorError(
      "POLICY_PIN",
      `${label} fields differ (extra=${extra.join(",") || "-"}, missing=${missing.join(",") || "-"})`,
    );
  }
}

function natString(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAT_STRING.test(value)) {
    throw new ValidatorError("POLICY_PIN", `${label} must be an unsigned decimal string`);
  }
  return value;
}

export function parseGovernanceSidecar(value: unknown): GovernanceSidecar {
  const raw = object(value, "governance sidecar");
  exactKeys(raw, SIDECAR_KEYS, "governance sidecar");
  if (raw.schema_version !== 1) {
    throw new ValidatorError("POLICY_PIN", "governance sidecar schema_version must be 1");
  }
  if (typeof raw.admin !== "string" || typeof raw.guardian !== "string") {
    throw new ValidatorError("POLICY_PIN", "governance sidecar admin/guardian must be addresses");
  }
  const signersRaw = object(raw.signers, "governance sidecar signers");
  const signers: Record<string, LogicalSigner> = {};
  for (const [index, value] of Object.entries(signersRaw)) {
    natString(index, "signer index");
    const signer = object(value, `signer ${index}`);
    exactKeys(signer, ["public_key", "class_id", "active"], `signer ${index}`);
    if (
      typeof signer.public_key !== "string" ||
      !signer.public_key.startsWith("edpk") ||
      typeof signer.class_id !== "string" ||
      signer.class_id.length === 0 ||
      typeof signer.active !== "boolean"
    ) {
      throw new ValidatorError("POLICY_PIN", `signer ${index} is malformed`);
    }
    signers[index] = {
      public_key: signer.public_key,
      class_id: signer.class_id,
      active: signer.active,
    };
  }
  const minimaRaw = object(raw.class_minima, "governance sidecar class_minima");
  const class_minima: Record<string, string> = {};
  for (const [classId, value] of Object.entries(minimaRaw)) {
    if (classId.length === 0) {
      throw new ValidatorError("POLICY_PIN", "class_minima keys must be non-empty");
    }
    class_minima[classId] = natString(value, `class_minima.${classId}`);
  }
  const thresholdN = BigInt(natString(raw.threshold_n, "threshold_n"));
  const thresholdM = BigInt(natString(raw.threshold_m, "threshold_m"));
  const active = Object.values(signers).filter((signer) => signer.active);
  if (
    thresholdN < 1n ||
    thresholdN > thresholdM ||
    thresholdM > 16n ||
    thresholdM !== BigInt(active.length)
  ) {
    throw new ValidatorError(
      "POLICY_PIN",
      "sidecar must satisfy 1 <= N <= M <= 16 and M == active signer count",
    );
  }
  if (new Set(Object.values(signers).map((signer) => signer.public_key)).size !== Object.keys(signers).length) {
    throw new ValidatorError("POLICY_PIN", "sidecar signer public keys must be unique");
  }
  let minimaSum = 0n;
  for (const [classId, minimum] of Object.entries(class_minima)) {
    const n = BigInt(minimum);
    const available = active.filter((signer) => signer.class_id === classId).length;
    if (n > BigInt(available)) {
      throw new ValidatorError("POLICY_PIN", `class minimum ${classId} exceeds active count`);
    }
    minimaSum += n;
  }
  if (minimaSum > thresholdN) {
    throw new ValidatorError("POLICY_PIN", "sum of class minima exceeds threshold_n");
  }
  return {
    schema_version: 1,
    admin: raw.admin,
    guardian: raw.guardian,
    threshold_n: thresholdN.toString(),
    threshold_m: thresholdM.toString(),
    signers,
    class_minima,
  };
}

export function loadGovernanceSidecar(path: string): GovernanceSidecar {
  return parseGovernanceSidecar(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function sidecarPathForVersion(
  configDir: string,
  configVersion: number | string,
): string {
  return join(configDir, "governance", `v${configVersion}`, "sidecar.json");
}

export function buildPinnedInit(
  snapshot: RegisterSnapshot,
  sidecar: GovernanceSidecar,
): LogicalInit {
  const assets: LogicalInit["assets"] = {};
  for (const [assetId, asset] of Object.entries(snapshot.assets)) {
    assets[assetId] = {
      decimals: String(asset.decimals),
      max_observation_age_seconds: String(asset.max_observation_age_seconds),
      absolute_min_price: asset.absolute_min_price,
      absolute_max_price: asset.absolute_max_price,
      max_movement_bps: String(asset.max_movement_bps),
    };
  }
  const groups: LogicalInit["groups"] = {};
  for (const [name, group] of Object.entries(snapshot.register.publication_groups)) {
    groups[name] = [...group.asset_ids];
  }
  const time = snapshot.register.time_policy;
  return {
    admin: sidecar.admin,
    guardian: sidecar.guardian,
    config_version: String(snapshot.register.config_version),
    policy_hash: hashPolicySnapshot(snapshot),
    threshold_n: sidecar.threshold_n,
    threshold_m: sidecar.threshold_m,
    activation_delay_levels: String(time.activation_delay_levels),
    min_activation_delay_levels: String(time.min_activation_delay_levels),
    max_clock_skew_seconds: String(time.max_clock_skew_seconds),
    validity_window_seconds: String(time.validity_window_seconds),
    price_nat_max: snapshot.register.payload.price_nat_max,
    signers: sidecar.signers,
    class_minima: sidecar.class_minima,
    groups,
    assets,
  };
}

export function parseGovernanceArtifact(value: unknown): GovernanceArtifact {
  const raw = object(value, "governance artifact");
  exactKeys(raw, ["intent", "packed_hex"], "governance artifact");
  if (
    typeof raw.packed_hex !== "string" ||
    !HEX.test(raw.packed_hex) ||
    !raw.packed_hex.startsWith("05") ||
    raw.packed_hex.length % 2 !== 0
  ) {
    throw new ValidatorError("POLICY_PIN", "artifact packed_hex must be lowercase PACK bytes");
  }
  return { intent: raw.intent, packed_hex: raw.packed_hex };
}

export function loadGovernanceArtifact(path: string): GovernanceArtifact {
  return parseGovernanceArtifact(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function domainOf(intent: unknown): string {
  const raw = object(intent, "governance intent");
  if (typeof raw.domain !== "string") {
    throw new ValidatorError("POLICY_PIN", "governance intent domain is required");
  }
  return raw.domain;
}

function envelope(intent: unknown): Record<string, unknown> {
  const raw = object(intent, "governance intent");
  return {
    domain: raw.domain,
    chain_id: raw.chain_id,
    oracle_address: raw.oracle_address,
    current_config_version: raw.current_config_version,
    governance_nonce: raw.governance_nonce,
    valid_until: raw.valid_until,
  };
}

export function rebuildAndPackGovernanceIntent(args: {
  artifact: GovernanceArtifact;
  snapshot: RegisterSnapshot;
  sidecar?: GovernanceSidecar;
  now: number;
  expectedChainId?: string;
  expectedOracleAddress?: string;
}): PackedPayload<object> {
  const domain = domainOf(args.artifact.intent);
  const artifactEnvelope = envelope(args.artifact.intent);
  if (
    args.expectedChainId !== undefined &&
    artifactEnvelope.chain_id !== args.expectedChainId
  ) {
    throw new ValidatorError("POLICY_PIN", "intent chain_id differs from local runtime");
  }
  if (
    args.expectedOracleAddress !== undefined &&
    artifactEnvelope.oracle_address !== args.expectedOracleAddress
  ) {
    throw new ValidatorError("POLICY_PIN", "intent oracle_address differs from local runtime");
  }
  let packed: PackedPayload<object>;
  if (domain === CONFIG_DOMAIN) {
    if (!args.sidecar) {
      throw new ValidatorError("POLICY_PIN", "config governance requires a local sidecar");
    }
    const locallyBuilt: LogicalConfigIntent = {
      ...(artifactEnvelope as Omit<LogicalConfigIntent, "init">),
      domain: CONFIG_DOMAIN,
      init: buildPinnedInit(args.snapshot, args.sidecar),
    };
    if (
      BigInt(locallyBuilt.init.config_version) !==
      BigInt(locallyBuilt.current_config_version) + 1n
    ) {
      throw new ValidatorError(
        "POLICY_PIN",
        "local register config_version must be current_config_version + 1",
      );
    }
    packed = packConfigIntent(locallyBuilt);
  } else if ((SIMPLE_GOVERNANCE_DOMAINS as readonly string[]).includes(domain)) {
    packed = packSimpleIntent(args.artifact.intent);
  } else if ((ASSET_GOVERNANCE_DOMAINS as readonly string[]).includes(domain)) {
    packed = packAssetIntent(args.artifact.intent);
  } else {
    throw new ValidatorError("POLICY_PIN", `unsupported governance domain ${domain}`);
  }
  if (BigInt((packed.payload as { valid_until: string }).valid_until) < BigInt(args.now)) {
    throw new ValidatorError("POLICY_PIN", "governance intent is expired");
  }
  if (packed.packedHex !== args.artifact.packed_hex) {
    throw new ValidatorError(
      "CANDIDATE_MISMATCH",
      "artifact packed_hex differs from locally rebuilt PACK",
    );
  }
  return packed;
}

export async function signGovernanceArtifact(args: {
  artifact: GovernanceArtifact;
  snapshot: RegisterSnapshot;
  sidecar?: GovernanceSidecar;
  secretKey: string;
  now: number;
  expectedChainId?: string;
  expectedOracleAddress?: string;
}): Promise<SignedGovernanceIntent> {
  if (!args.secretKey.startsWith("edsk")) {
    throw new ValidatorError("INTERNAL", "signer key must be an edsk secret");
  }
  const packed = rebuildAndPackGovernanceIntent(args);
  const signer = await InMemorySigner.fromSecretKey(args.secretKey);
  // Sign only our locally rebuilt PACK. artifact.packed_hex is comparison-only.
  const signed = await signer.sign(packed.packedHex);
  return {
    intent: packed.payload,
    packed_hex: packed.packedHex,
    blake2b_hex: packed.blake2bHex,
    public_key: await signer.publicKey(),
    public_key_hash: await signer.publicKeyHash(),
    signature: {
      sig: signed.sig,
      edsig: signed.prefixSig,
      sbytes: signed.sbytes,
    },
  };
}
