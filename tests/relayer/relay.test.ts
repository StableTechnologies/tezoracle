import assert from "node:assert/strict";
import test from "node:test";

import { sealCollection } from "../../src/coordinator/collect.js";
import {
  RELAYER_HOLDS_KEYS,
  assertNoOracleSigningKeys,
  createFailingSimulateRpc,
  createMockRpc,
  parseSignedBatch,
  relayBackup,
  relaySignedBatch,
  RelayerError,
  submitCallFromBatch,
  verifySignedBatch,
} from "../../src/relayer/index.js";
import {
  NOW,
  TRANSPORT_SIGNERS,
  collectIndices,
  openCoreCollection,
  signerSet1of1,
  signerSet3of4,
} from "../transport/helpers.js";

async function sealed1of1() {
  const state = await openCoreCollection();
  const next = await collectIndices(state, ["0"]);
  const sealed = sealCollection(next, NOW);
  assert.equal(sealed.ok, true);
  if (!sealed.ok) throw new Error("expected quorum");
  return sealed.batch;
}

test("relayer holds no signing keys", () => {
  assert.equal(RELAYER_HOLDS_KEYS, false);
  assert.throws(() => assertNoOracleSigningKeys({ secret_key: TRANSPORT_SIGNERS[0]?.secret_key }), RelayerError);
  assertNoOracleSigningKeys({ public_key: TRANSPORT_SIGNERS[0]?.public_key });
});

test("local verify accepts a 1-of-1 batch and rejects a bad signature", async () => {
  const batch = await sealed1of1();
  const ok = verifySignedBatch(batch, signerSet1of1());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.packed_hex, batch.packed_hex);

  const bad = {
    ...batch,
    signatures: batch.signatures.map((entry) => ({
      ...entry,
      signature: `${entry.signature.slice(0, -1)}${entry.signature.endsWith("A") ? "B" : "A"}`,
    })),
  };
  const failed = verifySignedBatch(bad, signerSet1of1());
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.code, "SIGNATURE");
});

test("relayer refuses mutated packed bytes", async () => {
  const batch = await sealed1of1();
  const mutated = { ...batch, packed_hex: `${batch.packed_hex.slice(0, -2)}aa` };
  const failed = verifySignedBatch(mutated, signerSet1of1());
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.code, "PACKED_MISMATCH");

  const priceFlip = {
    ...batch,
    payload: {
      ...batch.payload,
      assets: batch.payload.assets.map((asset, index) =>
        index === 0 ? { ...asset, price: String(BigInt(asset.price) + 1n) } : asset,
      ),
    },
  };
  const drifted = verifySignedBatch(priceFlip, signerSet1of1());
  assert.equal(drifted.ok, false);
  if (!drifted.ok) assert.equal(drifted.code, "PACKED_MISMATCH");
});

test("insufficient quorum is rejected before RPC", async () => {
  const state = await openCoreCollection({ signerSet: signerSet3of4() });
  const two = await collectIndices(state, ["0", "1"]);
  const sealed = sealCollection(two, NOW);
  assert.equal(sealed.ok, false);

  const incomplete = {
    domain: "TEZORACLE_SIGNED_BATCH_V1" as const,
    payload: two.candidate.payload,
    packed_hex: two.packed_hex,
    signatures: two.signatures,
  };
  const rpc = createMockRpc();
  const result = await relaySignedBatch({ batch: incomplete, signerSet: signerSet3of4(), rpc });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "QUORUM");
  assert.equal(rpc.simulates.length, 0);
  assert.equal(rpc.broadcasts.length, 0);
});

test("simulation failure does not broadcast", async () => {
  const batch = await sealed1of1();
  const rpc = createFailingSimulateRpc("PAUSED");
  const result = await relaySignedBatch({ batch, signerSet: signerSet1of1(), rpc });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "SIMULATE");
    assert.equal(result.packed_hex, batch.packed_hex);
  }
  assert.equal(rpc.simulates.length, 1);
  assert.equal(rpc.broadcasts.length, 0);
  assert.equal(rpc.confirms.length, 0);
});

test("primary then confirm on a healthy RPC", async () => {
  const batch = await sealed1of1();
  const rpc = createMockRpc({ op_hash: "opPrimary0001" });
  const result = await relaySignedBatch({ batch, signerSet: signerSet1of1(), rpc });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.op_hash, "opPrimary0001");
  assert.equal(result.packed_hex, batch.packed_hex);
  assert.equal(result.call.entrypoint, "submit");
  assert.equal(rpc.simulates[0]?.packed_hex, batch.packed_hex);
  assert.equal(rpc.broadcasts[0]?.packed_hex, batch.packed_hex);
});

test("coordinator down: backup relayer submits the same sealed bytes", async () => {
  const batch = await sealed1of1();
  const portable = parseSignedBatch(JSON.parse(JSON.stringify(batch)) as unknown);
  assert.equal(portable.packed_hex, batch.packed_hex);

  const primary = createFailingSimulateRpc("coordinator rpc down");
  const backup = createMockRpc({ op_hash: "opBackup0001" });
  const result = await relayBackup({
    batch: portable,
    signerSet: signerSet1of1(),
    primary,
    backup,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.op_hash, "opBackup0001");
  assert.equal(result.packed_hex, batch.packed_hex);
  assert.equal(primary.broadcasts.length, 0);
  assert.equal(backup.broadcasts[0]?.packed_hex, batch.packed_hex);
  assert.deepEqual(submitCallFromBatch(portable).packed_hex, submitCallFromBatch(batch).packed_hex);
});
