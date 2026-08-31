/**
 * Permissionless relayer.
 *
 * Holds no oracle signing keys. Must not mutate PACK(payload) bytes.
 * Locally verifies signatures, simulates, broadcasts, and confirms.
 * A backup relayer submits the same sealed batch if the primary path is down.
 */

export { RELAYER_HOLDS_KEYS, assertNoOracleSigningKeys } from "./keys.js";
export { RelayerError, RELAYER_CODES, type RelayerCode } from "./errors.js";
export {
  SIGNED_BATCH_DOMAIN,
  MAX_SIGNERS,
  type SignerSet,
  type SignerRecord,
  type SignedBatch,
  type BatchSignature,
  type SubmitCall,
  type RelayRpc,
  type RelayResult,
  type VerifyResult,
} from "./types.js";
export { parseSignerSet, assertSignerSet, lookupSigner, oneOfOne, nOfM } from "./signers.js";
export {
  parseSignedBatch,
  freezePackedHex,
  assertPackedBytesFrozen,
  submitMicheline,
  submitCallFromBatch,
  signedBatchFromParts,
  sortSignatures,
} from "./batch.js";
export { verifySignedBatch, verifySignedBatchOrThrow } from "./verify.js";
export {
  createMockRpc,
  createFailingSimulateRpc,
  createFailingBroadcastRpc,
  createHttpRelayRpc,
  type RecordingRpc,
} from "./rpc.js";
export { encodeSubmit, relaySignedBatch, relayBackup } from "./relay.js";
export { runCli } from "./cli.js";
