import type { HttpTransport } from "../validator/adapters/http.js";
import type { PoolRpcClient } from "../validator/adapters/dex/rpc.js";
import type { PoolSampleStore } from "../validator/adapters/dex/state.js";
import { candidateFromDerivation } from "../validator/candidate.js";
import { derivePublicationGroup } from "../validator/derive.js";
import { pinSnapshot } from "../validator/policy.js";
import type { CandidateDocument } from "../validator/types.js";
import { packPayload } from "../packing/pack.js";
import { CoordinatorError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import type { RoundRequest } from "./types.js";

export type AssembledCandidate = {
  request: RoundRequest;
  candidate: CandidateDocument;
  packed_hex: string;
};

/**
 * Assemble a candidate by independently deriving under the pinned register.
 * The coordinator does not accept a price, policy, or evidence override.
 */
export async function assembleCandidate(args: {
  request: RoundRequest;
  configDir: string;
  transport: HttpTransport;
  now: number;
  poolRpc?: PoolRpcClient;
  dexStateStore?: PoolSampleStore;
}): Promise<AssembledCandidate> {
  assertNoOracleSigningKeys(args.request, "candidate request");
  const { snapshot, policy_hash } = pinSnapshot(args.configDir);
  if (args.request.policy_hash !== policy_hash) {
    throw new CoordinatorError("POLICY_PIN", "round request policy_hash is not the pinned register hash");
  }
  if (args.request.config_version !== String(snapshot.register.config_version)) {
    throw new CoordinatorError("POLICY_PIN", "round request config_version is not the pinned register version");
  }
  const derivation = await derivePublicationGroup({
    snapshot,
    group: args.request.publication_group,
    transport: args.transport,
    now: args.now,
    round: args.request.round,
    poolRpc: args.poolRpc,
    dexStateStore: args.dexStateStore,
  });
  const candidate = candidateFromDerivation({
    derivation,
    chain_id: args.request.chain_id,
    oracle_address: args.request.oracle_address,
    round: args.request.round,
    valid_from: args.request.valid_from,
    valid_until: args.request.valid_until,
  });
  const packed_hex = packPayload(candidate.payload).packedHex;
  assertNoOracleSigningKeys({ candidate, packed_hex }, "assembled candidate");
  return { request: args.request, candidate, packed_hex };
}
