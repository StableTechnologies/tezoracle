import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHttpRelayRpc } from "../../src/relayer/rpc.js";
import { RelayerError } from "../../src/relayer/errors.js";

const keys = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "keys.json"), "utf8")) as {
  label: string;
  note: string;
  signers: Array<{ secret_key: string; public_key_hash: string }>;
};

test("transport edsks are labeled synthetic test-only", () => {
  assert.equal(keys.label, "tezoracle-transport-test-ed25519-v1");
  assert.match(keys.note, /SYNTHETIC TEST-ONLY KEYS/);
  assert.match(keys.note, /Never funded/);
  assert.equal(keys.signers.length, 4);
  assert.equal(keys.signers[0]?.public_key_hash, "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL");
});

test("live HTTP RPC adapter is not a production endpoint", () => {
  assert.throws(() => createHttpRelayRpc({ rpcUrl: "https://example.invalid" }), RelayerError);
});
