/**
 * Non-authoritative coordinator.
 *
 * Holds no signing keys. Does not choose price or policy. May trigger a round
 * and assemble a candidate by deriving under the pinned register. Validators
 * independently verify. Absence of this process does not block a permissionless
 * relayer from submitting an independently assembled signed batch.
 */

export { COORDINATOR_HOLDS_KEYS, assertNoOracleSigningKeys } from "./keys.js";
export { CoordinatorError, COORDINATOR_CODES, type CoordinatorCode } from "./errors.js";
export { triggerRound } from "./round.js";
export { assembleCandidate, type AssembledCandidate } from "./candidate.js";
export {
  openCollection,
  parseIncomingSignature,
  collectSignature,
  sealCollection,
  closeIncomplete,
} from "./collect.js";
export { runCli } from "./cli.js";
export {
  ROUND_REQUEST_DOMAIN,
  COLLECTION_DOMAIN,
  type RoundRequest,
  type CollectionState,
  type CollectionStatus,
  type IncomingSignature,
  type SealResult,
} from "./types.js";
