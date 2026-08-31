import assert from "node:assert/strict";
import test from "node:test";

import { assembleCandidate } from "../../src/coordinator/candidate.js";
import {
  closeIncomplete,
  collectSignature,
  openCollection,
  sealCollection,
} from "../../src/coordinator/collect.js";
import { CoordinatorError } from "../../src/coordinator/errors.js";
import { COORDINATOR_HOLDS_KEYS, assertNoOracleSigningKeys } from "../../src/coordinator/keys.js";
import { triggerRound } from "../../src/coordinator/round.js";
import {
  CHAIN_ID,
  NOW,
  ORACLE_ADDRESS,
  ROOT,
  TRANSPORT_SIGNERS,
  collectIndices,
  coreMockTransport,
  openCoreCollection,
  signIndex,
  signerSet1of1,
  signerSet3of4,
} from "../transport/helpers.js";

test("coordinator holds no signing keys", () => {
  assert.equal(COORDINATOR_HOLDS_KEYS, false);
  assert.throws(() => assertNoOracleSigningKeys({ secret_key: TRANSPORT_SIGNERS[0]?.secret_key }), CoordinatorError);
  assert.throws(() => assertNoOracleSigningKeys({ key: TRANSPORT_SIGNERS[0]?.secret_key }), CoordinatorError);
  assertNoOracleSigningKeys({ public_key: TRANSPORT_SIGNERS[0]?.public_key });
});

test("triggerRound copies policy from the pinned register and refuses unknown groups", () => {
  const request = triggerRound({
    configDir: `${ROOT}/config`,
    group: "CORE",
    round: "7",
    now: NOW,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
  });
  assert.equal(request.domain, "TEZORACLE_ROUND_V1");
  assert.equal(request.publication_group, "CORE");
  assert.equal(request.round, "7");
  assert.equal(request.config_version, "3");
  assert.match(request.policy_hash, /^[0-9a-f]{64}$/);
  assert.throws(
    () =>
      triggerRound({
        configDir: `${ROOT}/config`,
        group: "NOT_A_GROUP",
        now: NOW,
        chain_id: CHAIN_ID,
        oracle_address: ORACLE_ADDRESS,
      }),
    CoordinatorError,
  );
});

test("assembleCandidate derives CORE under fixtures and refuses stub groups", async () => {
  const request = triggerRound({
    configDir: `${ROOT}/config`,
    group: "CORE",
    now: NOW,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
  });
  const assembled = await assembleCandidate({
    request,
    configDir: `${ROOT}/config`,
    transport: coreMockTransport(),
    now: NOW,
  });
  assert.equal(assembled.candidate.payload.publication_group, "CORE");
  assert.equal(assembled.candidate.payload.assets.length, 3);
  assert.equal(assembled.packed_hex.startsWith("05"), true);
  assert.equal(assembled.candidate.payload.policy_hash, request.policy_hash);

  const stub = { ...request, publication_group: "USDTZ" };
  await assert.rejects(
    assembleCandidate({ request: stub, configDir: `${ROOT}/config`, transport: coreMockTransport(), now: NOW }),
    CoordinatorError,
  );
});

test("1-of-1 collection seals a portable batch", async () => {
  const state = await openCoreCollection();
  const next = await collectIndices(state, ["0"]);
  assert.equal(next.status, "quorum");
  const sealed = sealCollection(next, NOW);
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  assert.equal(sealed.batch.domain, "TEZORACLE_SIGNED_BATCH_V1");
  assert.equal(sealed.batch.packed_hex, state.packed_hex);
  assert.equal(sealed.batch.signatures.length, 1);
});

test("3-of-4 collection refuses insufficient quorum and accepts N plus class minima", async () => {
  const state = await openCoreCollection({ signerSet: signerSet3of4() });
  const two = await collectIndices(state, ["0", "1"]);
  assert.equal(two.status, "open");
  const early = sealCollection(two, NOW);
  assert.equal(early.ok, false);
  if (early.ok) return;
  assert.equal(early.code, "QUORUM");

  const threeA = await collectIndices(two, ["2"]);
  assert.equal(threeA.status, "open");
  const missingB = sealCollection(threeA, NOW);
  assert.equal(missingB.ok, false);

  const quorum = await collectIndices(two, ["3"]);
  assert.equal(quorum.status, "quorum");
  const sealed = sealCollection(quorum, NOW);
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  assert.equal(sealed.batch.signatures.length, 3);
});

test("bad and duplicate signatures are rejected", async () => {
  const state = await openCoreCollection();
  const good = await signIndex(state, "0");
  await assert.rejects(
    async () => collectSignature(state, { ...good, signature: good.signature.replace("e", "f") }, NOW),
    CoordinatorError,
  );
  await assert.rejects(
    async () => collectSignature(state, { ...good, packed_hex: `${good.packed_hex}00` }, NOW),
    CoordinatorError,
  );
  await assert.rejects(
    async () => collectSignature(state, { ...good, index: "9" }, NOW),
    CoordinatorError,
  );
  const once = collectSignature(state, good, NOW);
  assert.throws(() => collectSignature(once, good, NOW), CoordinatorError);
});

test("timeout and incomplete close fail closed", async () => {
  const state = await openCoreCollection({
    signerSet: signerSet3of4(),
    collect_timeout_seconds: 1,
  });
  const timed = collectSignature(state, await signIndex(state, "0"), NOW + 2);
  assert.equal(timed.status, "timeout");
  const sealedTimeout = sealCollection(timed, NOW + 2);
  assert.equal(sealedTimeout.ok, false);
  if (!sealedTimeout.ok) assert.equal(sealedTimeout.code, "TIMEOUT");

  const open = await openCoreCollection({ signerSet: signerSet3of4() });
  const one = await collectIndices(open, ["0"]);
  const closed = closeIncomplete(one);
  const sealedIncomplete = sealCollection(closed, NOW);
  assert.equal(sealedIncomplete.ok, false);
  if (!sealedIncomplete.ok) assert.equal(sealedIncomplete.code, "INCOMPLETE");
});

test("openCollection refuses a drifted packed_hex", async () => {
  const state = await openCoreCollection();
  assert.throws(
    () =>
      openCollection({
        request: state.request,
        candidate: state.candidate,
        packed_hex: `${state.packed_hex}aa`,
        signerSet: signerSet1of1(),
      }),
    CoordinatorError,
  );
});
