import type { HttpTransport } from "../validator/adapters/http.js";
import type { PoolRpcClient } from "../validator/adapters/dex/rpc.js";
import type { PoolSampleStore } from "../validator/adapters/dex/state.js";
import type { CandidateDocument, SharedEvidenceManifest } from "../validator/types.js";
import type { SignedBatch, SignerSet, RelayRpc } from "../relayer/types.js";

export const TICK_CADENCE_SECONDS = 300;

export type PriceView =
  | { ok: true; price: string; observation_time: number }
  | { ok: false; code: string; detail: string };

export type OracleView = {
  level(): number;
  paused(): boolean;
  pendingConfig(): boolean;
  lastRound(group: string): string | undefined;
  immaturePending(assetIds: string[]): boolean;
  getPrice(assetId: string): PriceView;
};

export type SignedCandidate = {
  index: string;
  public_key: string;
  signature: string;
  packed_hex: string;
};

export type SignCandidate = (args: {
  candidate: CandidateDocument;
  packed_hex: string;
  now: number;
  index: string;
}) => Promise<SignedCandidate>;

export type TickDeps = {
  configDir: string;
  transport: HttpTransport;
  rpc: RelayRpc;
  oracle: OracleView;
  signerSet: SignerSet;
  sign: SignCandidate;
  now: () => number;
  chain_id: string;
  oracle_address: string;
  group?: string;
  signerIndex?: string;
  poolRpc?: PoolRpcClient;
  dexStateStore?: PoolSampleStore;
};

export type TickSuccess = {
  ok: true;
  skipped: false;
  round: string;
  packed_hex: string;
  op_hash: string;
  policy_hash: string;
  evidence_digest: string;
  evidence: SharedEvidenceManifest;
  valid_from: string;
  valid_until: string;
  elapsed_seconds: number;
  batch: SignedBatch;
  views: Record<string, PriceView>;
};

export type TickSkip = {
  ok: true;
  skipped: true;
  reason: "PENDING_OPEN";
  detail: string;
};

export type TickFailure = {
  ok: false;
  skipped: false;
  error_code: string;
  detail: string;
};

export type TickResult = TickSuccess | TickSkip | TickFailure;
