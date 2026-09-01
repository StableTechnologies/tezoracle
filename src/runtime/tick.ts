import { assembleCandidate } from "../coordinator/candidate.js";
import { collectSignature, openCollection, sealCollection } from "../coordinator/collect.js";
import { CoordinatorError } from "../coordinator/errors.js";
import { assertNoOracleSigningKeys } from "../coordinator/keys.js";
import { triggerRound } from "../coordinator/round.js";
import { RelayerError } from "../relayer/errors.js";
import { relaySignedBatch } from "../relayer/relay.js";
import { verifySignedBatch } from "../relayer/verify.js";
import { ValidatorError } from "../validator/errors.js";
import { pinSnapshot } from "../validator/policy.js";
import type { PriceView, TickDeps, TickFailure, TickResult } from "./types.js";

function fail(error: unknown): TickFailure {
  if (error instanceof CoordinatorError || error instanceof RelayerError || error instanceof ValidatorError) {
    return { ok: false, skipped: false, error_code: error.code, detail: error.message };
  }
  return {
    ok: false,
    skipped: false,
    error_code: "INTERNAL",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function nextRound(last: string | undefined): string {
  if (last === undefined) return "1";
  return (BigInt(last) + 1n).toString();
}

/**
 * One publication tick. Composes coordinator, Class A sign, and relayer.
 * No new policy. Fail-closed on the same codes. Coordinator/relayer still
 * hold no keys — `sign` is injected.
 */
export async function runTick(deps: TickDeps): Promise<TickResult> {
  try {
    assertNoOracleSigningKeys(
      {
        chain_id: deps.chain_id,
        oracle_address: deps.oracle_address,
        group: deps.group,
        signerSet: deps.signerSet,
      },
      "tick",
    );
    const group = deps.group ?? "CORE";
    const started = deps.now();
    const { snapshot } = pinSnapshot(deps.configDir);
    const window = snapshot.register.time_policy.validity_window_seconds;
    const assetIds = snapshot.register.publication_groups[group]?.asset_ids ?? [];

    if (deps.oracle.paused()) {
      return { ok: false, skipped: false, error_code: "PAUSED", detail: "oracle is paused" };
    }
    if (deps.oracle.pendingConfig()) {
      return {
        ok: false,
        skipped: false,
        error_code: "POLICY_PIN",
        detail: "pending governance must activate before a new publication",
      };
    }
    if (deps.oracle.immaturePending(assetIds)) {
      return {
        ok: true,
        skipped: true,
        reason: "PENDING_OPEN",
        detail: "previous pending quote is still immature; activation delay is unchanged",
      };
    }

    const round = nextRound(deps.oracle.lastRound(group));
    const request = triggerRound({
      configDir: deps.configDir,
      group,
      round,
      now: started,
      chain_id: deps.chain_id,
      oracle_address: deps.oracle_address,
    });
    const assembled = await assembleCandidate({
      request,
      configDir: deps.configDir,
      transport: deps.transport,
      now: started,
    });
    const current = deps.now();
    if (current > Number(assembled.request.valid_until) || current - started > window) {
      return {
        ok: false,
        skipped: false,
        error_code: "POLICY_PIN",
        detail: "tick exceeded validity_window_seconds; fail closed",
      };
    }

    const state = openCollection({
      request: assembled.request,
      candidate: assembled.candidate,
      packed_hex: assembled.packed_hex,
      signerSet: deps.signerSet,
    });
    const signed = await deps.sign({
      candidate: assembled.candidate,
      packed_hex: assembled.packed_hex,
      now: current,
      index: deps.signerIndex ?? "0",
    });
    const collected = collectSignature(state, signed, current);
    const sealed = sealCollection(collected, current);
    if (!sealed.ok) {
      return { ok: false, skipped: false, error_code: sealed.code, detail: sealed.detail };
    }

    const verified = verifySignedBatch(sealed.batch, deps.signerSet);
    if (!verified.ok) {
      return { ok: false, skipped: false, error_code: verified.code, detail: verified.detail };
    }

    const relayed = await relaySignedBatch({
      batch: sealed.batch,
      signerSet: deps.signerSet,
      rpc: deps.rpc,
    });
    if (!relayed.ok) {
      return { ok: false, skipped: false, error_code: relayed.code, detail: relayed.detail };
    }

    const views: Record<string, PriceView> = {};
    for (const assetId of assetIds) {
      views[assetId] = deps.oracle.getPrice(assetId);
    }

    return {
      ok: true,
      skipped: false,
      round,
      packed_hex: sealed.packed_hex,
      op_hash: relayed.op_hash,
      policy_hash: assembled.candidate.payload.policy_hash,
      evidence_digest: assembled.candidate.payload.evidence_digest,
      evidence: assembled.candidate.evidence,
      valid_from: assembled.request.valid_from,
      valid_until: assembled.request.valid_until,
      elapsed_seconds: deps.now() - started,
      batch: sealed.batch,
      views,
    };
  } catch (error) {
    return fail(error);
  }
}
