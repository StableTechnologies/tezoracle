import { verifySignature } from "@taquito/utils";

import {
  packAssetIntent,
  packConfigIntent,
  packSimpleIntent,
} from "../packing/governance.js";
import {
  ASSET_GOVERNANCE_DOMAINS,
  CONFIG_DOMAIN,
  SIMPLE_GOVERNANCE_DOMAINS,
} from "../packing/governance_types.js";
import { assertSignerSet } from "../relayer/signers.js";
import type { SignerRecord, SignerSet } from "../relayer/types.js";
import { CoordinatorError } from "../coordinator/errors.js";
import { assertNoOracleSigningKeys } from "../coordinator/keys.js";
import {
  parseGovernanceArtifact,
  type GovernanceArtifact,
} from "../validator/governance.js";

export const GOVERNANCE_COLLECTION_DOMAIN =
  "TEZORACLE_GOVERNANCE_COLLECTION_V1" as const;

export type GovernanceSignature = {
  index: string;
  public_key: string;
  signature: string;
};

export type IncomingGovernanceSignature = GovernanceSignature & {
  packed_hex: string;
};

export type GovernanceCollectionState = {
  domain: typeof GOVERNANCE_COLLECTION_DOMAIN;
  artifact: GovernanceArtifact;
  signer_set: SignerSet;
  collect_until: string;
  signatures: GovernanceSignature[];
  status: "open" | "quorum" | "timeout" | "incomplete";
};

export type GovernanceCallBundle = {
  intent: object;
  packed_hex: string;
  signatures: Array<{ index: string; signature: string }>;
};

function signerAt(set: SignerSet, index: string): SignerRecord {
  const signer = set.signers.find((entry) => entry.index === index);
  if (!signer) {
    throw new CoordinatorError("UNKNOWN_SIGNER", `index ${index} is not in the signer set`);
  }
  if (!signer.active) {
    throw new CoordinatorError("INACTIVE_SIGNER", `index ${index} is inactive`);
  }
  return signer;
}

function packedIntent(intent: unknown): { payload: object; packedHex: string } {
  if (typeof intent !== "object" || intent === null || Array.isArray(intent)) {
    throw new CoordinatorError("POLICY_PIN", "governance intent must be an object");
  }
  const domain = (intent as Record<string, unknown>).domain;
  try {
    if (domain === CONFIG_DOMAIN) return packConfigIntent(intent);
    if (
      typeof domain === "string" &&
      (SIMPLE_GOVERNANCE_DOMAINS as readonly string[]).includes(domain)
    ) {
      return packSimpleIntent(intent);
    }
    if (
      typeof domain === "string" &&
      (ASSET_GOVERNANCE_DOMAINS as readonly string[]).includes(domain)
    ) {
      return packAssetIntent(intent);
    }
  } catch (error) {
    throw new CoordinatorError(
      "POLICY_PIN",
      error instanceof Error ? error.message : String(error),
    );
  }
  throw new CoordinatorError("POLICY_PIN", `unsupported governance domain ${String(domain)}`);
}

function isTimedOut(state: GovernanceCollectionState, now: number): boolean {
  return BigInt(now) > BigInt(state.collect_until);
}

function hasFullCommittee(state: GovernanceCollectionState): boolean {
  return state.signatures.length === state.signer_set.threshold_m;
}

export function openGovernanceCollection(args: {
  artifact: unknown;
  signerSet: SignerSet;
  collectUntil: string;
}): GovernanceCollectionState {
  assertNoOracleSigningKeys(args, "open governance collection");
  assertSignerSet(args.signerSet);
  if (!/^[1-9][0-9]*$/.test(args.collectUntil)) {
    throw new CoordinatorError("INTERNAL", "collectUntil must be positive Unix seconds");
  }
  let artifact: GovernanceArtifact;
  try {
    artifact = parseGovernanceArtifact(args.artifact);
  } catch (error) {
    throw new CoordinatorError(
      "POLICY_PIN",
      error instanceof Error ? error.message : String(error),
    );
  }
  const packed = packedIntent(artifact.intent);
  if (packed.packedHex !== artifact.packed_hex) {
    throw new CoordinatorError(
      "PACKED_MISMATCH",
      "artifact packed_hex does not match PACK(intent)",
    );
  }
  return {
    domain: GOVERNANCE_COLLECTION_DOMAIN,
    artifact: { intent: packed.payload, packed_hex: packed.packedHex },
    signer_set: args.signerSet,
    collect_until: args.collectUntil,
    signatures: [],
    status: "open",
  };
}

export function collectGovernanceSignature(
  state: GovernanceCollectionState,
  incoming: IncomingGovernanceSignature,
  now: number,
): GovernanceCollectionState {
  assertNoOracleSigningKeys(incoming, "governance signature");
  if (state.status !== "open") {
    throw new CoordinatorError("INTERNAL", `collection is ${state.status}`);
  }
  if (isTimedOut(state, now)) return { ...state, status: "timeout" };
  if (incoming.packed_hex !== state.artifact.packed_hex) {
    throw new CoordinatorError("PACKED_MISMATCH", "signature covers different bytes");
  }
  const signer = signerAt(state.signer_set, incoming.index);
  if (signer.public_key !== incoming.public_key) {
    throw new CoordinatorError("SIGNATURE", `public key mismatch for index ${incoming.index}`);
  }
  if (state.signatures.some((entry) => entry.index === incoming.index)) {
    throw new CoordinatorError("DUPLICATE", `index ${incoming.index} already collected`);
  }
  let valid = false;
  try {
    valid = verifySignature(
      incoming.packed_hex,
      incoming.public_key,
      incoming.signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new CoordinatorError("SIGNATURE", `invalid signature for index ${incoming.index}`);
  }
  const next: GovernanceCollectionState = {
    ...state,
    signatures: [
      ...state.signatures,
      {
        index: incoming.index,
        public_key: incoming.public_key,
        signature: incoming.signature,
      },
    ],
  };
  if (hasFullCommittee(next)) next.status = "quorum";
  return next;
}

export function closeGovernanceCollection(
  state: GovernanceCollectionState,
): GovernanceCollectionState {
  if (state.status === "quorum") return state;
  return { ...state, status: "incomplete" };
}

export function assembleGovernanceCall(
  state: GovernanceCollectionState,
  now: number,
): GovernanceCallBundle {
  const packed = packedIntent(state.artifact.intent);
  if (packed.packedHex !== state.artifact.packed_hex) {
    throw new CoordinatorError("PACKED_MISMATCH", "collection intent drifted");
  }
  if (isTimedOut(state, now)) {
    throw new CoordinatorError("TIMEOUT", "governance collection expired");
  }
  if (!hasFullCommittee(state)) {
    throw new CoordinatorError(
      "QUORUM",
      `governance requires ${state.signer_set.threshold_m} of ${state.signer_set.threshold_m} active signatures`,
    );
  }
  return {
    intent: packed.payload,
    packed_hex: packed.packedHex,
    signatures: state.signatures.map(({ index, signature }) => ({ index, signature })),
  };
}
