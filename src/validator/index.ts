/**
 * Class A TypeScript validator.
 *
 * Observe approved CEX venues, derive under the pinned register, verify a
 * candidate, and sign only PACK(payload). Testnet / non-authoritative only.
 */

export { TEZORACLE_VERSION, STATUS, VALIDATOR_CLASS } from "./version.js";
export { ValidatorError, REFUSAL_CODES, type RefusalCode } from "./errors.js";
export { canonicalJson } from "./canonical.js";
export {
  parseDecimalString,
  roundHalfAwayFromZero,
  scaleToDecimals,
  mulScale,
  divScale,
  medianLower,
} from "./decimal.js";
export { pinSnapshot, policyHashHex, softwareArtifactHash, defaultConfigDir } from "./policy.js";
export {
  binanceAdapter,
  okxAdapter,
  krakenAdapter,
  coinbaseAdapter,
  getAdapter,
  listAdapters,
  INITIAL_PHASE_SOURCE_IDS,
  createMockTransport,
  defaultHttpTransport,
  sourceUrl,
} from "./adapters/index.js";
export { fetchSource, applyTimeAndNormalization } from "./observe.js";
export { deriveAssetFromObservations, derivePublicationGroup } from "./derive.js";
export { buildSharedManifest, evidenceDigestHex, parseSharedManifest, contributingTime } from "./evidence.js";
export { verifyCandidate, parseCandidateDocument, candidateFromDerivation } from "./candidate.js";
export { signPackedPayload, loadRoundState, saveRoundState, assertFreshRound, commitRound } from "./signer.js";
export { runCli } from "./cli.js";
export type {
  SharedEvidenceManifest,
  GroupDerivation,
  VerificationResult,
  SignedPayload,
  CandidateDocument,
} from "./types.js";
