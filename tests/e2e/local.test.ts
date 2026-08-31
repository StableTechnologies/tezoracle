import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectSignature, openCollection } from "../../src/coordinator/collect.js";
import { assembleCandidate } from "../../src/coordinator/candidate.js";
import { triggerRound } from "../../src/coordinator/round.js";
import { pinSnapshot } from "../../src/validator/policy.js";
import { evidenceDigestHex } from "../../src/validator/evidence.js";
import { signPackedPayload } from "../../src/validator/signer.js";
import { TICK_CADENCE_SECONDS, type PriceView } from "../../src/runtime/types.js";
import { runTick } from "../../src/runtime/tick.js";
import { runTickLoop, startTickInterval } from "../../src/runtime/loop.js";
import { relaySignedBatch } from "../../src/relayer/relay.js";
import { clone } from "../validator/helpers.js";
import {
  CHAIN_ID,
  CLASS_A_SIGNER,
  CONFIG_DIR,
  NOW,
  ORACLE_ADDRESS,
  TRANSPORT_SIGNERS,
  baseTickDeps,
  coreMockTransportAt,
  localSign,
  publishedTick,
  signerSet1of1,
  signerSet3of4,
  tickHarness,
  verifyingSign,
} from "./helpers.js";

const CORE_ASSETS = ["BTC_USD", "USDT_USD", "XTZ_USD"] as const;

test("register validity window stays 180 and cadence is 300 seconds", () => {
  const { snapshot } = pinSnapshot(CONFIG_DIR);
  assert.equal(snapshot.register.time_policy.validity_window_seconds, 180);
  assert.equal(TICK_CADENCE_SECONDS, 300);
  assert.equal(TICK_CADENCE_SECONDS > snapshot.register.time_policy.validity_window_seconds, true);
});

test("happy path 1-of-1 observe → derive → sign → submit → read view", async () => {
  const { result, harness } = await publishedTick();
  assert.equal(result.ok, true);
  if (!result.ok || result.skipped) throw new Error("expected a published tick");
  assert.equal(result.round, "1");
  assert.equal(result.packed_hex.startsWith("05"), true);
  assert.match(result.policy_hash, /^[0-9a-f]{64}$/);
  assert.match(result.evidence_digest, /^[0-9a-f]{64}$/);
  assert.equal(result.evidence.domain, "TEZORACLE_EVIDENCE_V1");
  assert.equal(result.evidence.publication_group, "CORE");
  assert.equal(result.valid_until, String(NOW + 180));
  assert.equal(result.elapsed_seconds <= 180, true);
  assert.equal(harness.lastRound("CORE"), "1");
  assert.equal(harness.submitted.length, 1);
  for (const assetId of CORE_ASSETS) {
    const view: PriceView | undefined = result.views[assetId];
    assert.ok(view);
    assert.equal(view.ok, false);
    if (!view.ok) assert.equal(view.code, "NO_PRICE");
  }
  harness.advanceLevel();
  for (const assetId of CORE_ASSETS) {
    const view = harness.getPrice(assetId);
    assert.equal(view.ok, true);
    if (view.ok) assert.match(view.price, /^[1-9][0-9]*$/);
  }
});

test("PENDING_OPEN skips and does not weaken activation delay", async () => {
  const harness = tickHarness();
  const first = await runTick(baseTickDeps({ harness }));
  assert.equal(first.ok, true);
  if (!first.ok || first.skipped) throw new Error("expected first publication");
  const skipped = await runTick(baseTickDeps({ harness, sign: localSign() }));
  assert.equal(skipped.ok, true);
  if (!skipped.ok) throw new Error("expected skip");
  assert.equal(skipped.skipped, true);
  if (skipped.skipped) assert.equal(skipped.reason, "PENDING_OPEN");
  assert.equal(harness.lastRound("CORE"), "1");
  assert.equal(harness.submitted.length, 1);
  for (const assetId of CORE_ASSETS) {
    assert.ok(harness.pending[assetId]);
    assert.equal(harness.getPrice(assetId).ok, false);
  }
});

test("two ticks 300s apart do not reuse a round", async () => {
  let now = NOW;
  const harness = tickHarness({ now });
  const state = {};
  const seen: Array<Awaited<ReturnType<typeof runTick>>> = [];
  const results = await runTickLoop({
    tick: () =>
      runTick(
        baseTickDeps({
          now: () => now,
          harness,
          sign: localSign(state),
        }),
      ),
    cadenceSeconds: TICK_CADENCE_SECONDS,
    clock: { now: () => now },
    sleep: async (seconds) => {
      now += seconds;
      harness.setNow(now);
    },
    shouldContinue: () => seen.length < 2,
    onResult: async (result) => {
      seen.push(result);
      if (result.ok && !result.skipped) harness.advanceLevel();
    },
  });
  assert.equal(results.length, 2);
  assert.equal(results[0]?.ok, true);
  assert.equal(results[1]?.ok, true);
  if (!results[0]?.ok || results[0].skipped || !results[1]?.ok || results[1].skipped) {
    throw new Error("expected two publications");
  }
  assert.equal(results[0].round, "1");
  assert.equal(results[1].round, "2");
  assert.notEqual(results[0].packed_hex, results[1].packed_hex);
  assert.equal(now, NOW + TICK_CADENCE_SECONDS);
});

test("setInterval driver fires then can be stopped", async () => {
  const harness = tickHarness();
  const results: Array<Awaited<ReturnType<typeof runTick>>> = [];
  let ticks = 0;
  const handle = startTickInterval({
    tick: () => {
      ticks += 1;
      return runTick(baseTickDeps({ harness, sign: localSign() }));
    },
    cadenceSeconds: TICK_CADENCE_SECONDS,
    onResult: (result) => {
      results.push(result);
    },
    schedule: (_fn, ms) => {
      assert.equal(ms, TICK_CADENCE_SECONDS * 1000);
      return { stop() {} };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  handle.stop();
  assert.equal(ticks, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.ok, true);
});

test("shadow USDTZ and TZBTC are not consumed", async () => {
  for (const group of ["USDTZ", "TZBTC"] as const) {
    const result = await runTick(baseTickDeps({ group }));
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error_code, "STUB_GROUP");
  }
});

test("quorum negative: 3-of-4 set with one signature fails closed", async () => {
  const result = await runTick(baseTickDeps({ signerSet: signerSet3of4() }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error_code, "QUORUM");
});

test("unauthorized signature is refused", async () => {
  const other = TRANSPORT_SIGNERS[1];
  if (!other) throw new Error("missing transport signer 1");
  const result = await runTick(
    baseTickDeps({
      sign: async (args) => {
        const signed = await signPackedPayload({
          payload: args.candidate.payload,
          secretKey: other.secret_key,
          signerId: "unauthorized",
          state: {},
          now: args.now,
        });
        return {
          index: args.index,
          public_key: CLASS_A_SIGNER.public_key,
          signature: signed.signature.edsig,
          packed_hex: signed.packed_hex,
        };
      },
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error_code, "SIGNATURE");
});

test("duplicate signature is refused", async () => {
  const request = triggerRound({
    configDir: CONFIG_DIR,
    group: "CORE",
    round: "1",
    now: NOW,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
  });
  const assembled = await assembleCandidate({
    request,
    configDir: CONFIG_DIR,
    transport: coreMockTransportAt(NOW),
    now: NOW,
  });
  const state = openCollection({
    request: assembled.request,
    candidate: assembled.candidate,
    packed_hex: assembled.packed_hex,
    signerSet: signerSet3of4(),
  });
  const signed = await localSign()({
    candidate: assembled.candidate,
    packed_hex: assembled.packed_hex,
    now: NOW,
    index: "0",
  });
  const once = collectSignature(state, signed, NOW);
  assert.equal(once.status, "open");
  assert.throws(() => collectSignature(once, signed, NOW), /DUPLICATE/);
});

test("replay of the same round and a wrong domain fail closed", async () => {
  const { result, harness } = await publishedTick();
  assert.equal(result.ok, true);
  if (!result.ok || result.skipped) throw new Error("expected publication");
  const replay = await relaySignedBatch({
    batch: result.batch,
    signerSet: signerSet1of1(),
    rpc: harness,
  });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.detail, "ROUND");

  const domainCall = {
    ...harness.submitted[0]!,
    batch: {
      ...result.batch,
      payload: { ...result.batch.payload, domain: "NOT_TEZORACLE" as typeof result.batch.payload.domain },
    },
  };
  const domain = await harness.simulate(domainCall);
  assert.equal(domain.ok, false);
  if (!domain.ok) assert.equal(domain.error, "DOMAIN");
});

test("stale and future observations fail closed", async () => {
  const pinned = coreMockTransportAt(NOW);
  const stale = await runTick(
    baseTickDeps({
      now: () => NOW + 10_000,
      harness: tickHarness({ now: NOW + 10_000 }),
      transport: pinned,
    }),
  );
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error_code, "INSUFFICIENT");

  const future = await runTick(
    baseTickDeps({
      now: () => NOW - 10_000,
      harness: tickHarness({ now: NOW - 10_000 }),
      transport: pinned,
    }),
  );
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.error_code, "INSUFFICIENT");
});

test("evidence mismatch is refused by Class A", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "tezoracle-e2e-"));
  const sign = verifyingSign({ now: () => NOW, transport: coreMockTransportAt(NOW), statePath: join(tmp, "round.json") });
  const result = await runTick(
    baseTickDeps({
      sign: async (args) => {
        const mutated = clone(args.candidate);
        const first = mutated.evidence.assets[0];
        if (first) first.price = String(BigInt(first.price) + 1n);
        mutated.payload.evidence_digest = evidenceDigestHex(mutated.evidence);
        return sign({ ...args, candidate: mutated });
      },
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error_code === "EVIDENCE_DIGEST" || result.error_code === "EVIDENCE_PRICE" || result.error_code === "EVIDENCE_LOCAL");
  }
});

test("pause fails closed", async () => {
  const harness = tickHarness();
  harness.setPaused(true);
  const result = await runTick(baseTickDeps({ harness }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error_code, "PAUSED");
  assert.equal(harness.submitted.length, 0);
});

test("pending governance fails closed", async () => {
  const harness = tickHarness();
  harness.setPendingConfig(true);
  const result = await runTick(baseTickDeps({ harness }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error_code, "POLICY_PIN");
  assert.equal(harness.submitted.length, 0);
});

test("tick fails closed when it exceeds the 180s validity window", async () => {
  const times = [NOW, NOW + 181];
  let i = 0;
  const deps = baseTickDeps({ now: () => NOW });
  deps.now = () => times[Math.min(i++, times.length - 1)]!;
  const result = await runTick(deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error_code, "POLICY_PIN");
});
