import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli as runCoordinatorCli } from "../../src/coordinator/cli.js";
import { sealCollection } from "../../src/coordinator/collect.js";
import type { CollectionState } from "../../src/coordinator/types.js";
import { runCli as runRelayerCli } from "../../src/relayer/cli.js";
import { createFailingSimulateRpc, createMockRpc } from "../../src/relayer/rpc.js";
import {
  CHAIN_ID,
  FIXTURES_PATH,
  NOW,
  ORACLE_ADDRESS,
  ROOT,
  collectIndices,
  openCoreCollection,
  signIndex,
  signerSet1of1,
} from "./helpers.js";

async function capture(run: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const previous = process.stdout.write;
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run();
    return { code, stdout };
  } finally {
    process.stdout.write = previous;
  }
}

test("coordinator CLI --help exits 0", async () => {
  const { code } = await capture(() => runCoordinatorCli(["--help"]));
  assert.equal(code, 0);
});

test("coordinator CLI candidate prints a CORE payload from fixtures", async () => {
  const { code, stdout } = await capture(() =>
    runCoordinatorCli([
      "candidate",
      "--group",
      "CORE",
      "--fixtures",
      FIXTURES_PATH,
      "--now",
      String(NOW),
      "--config",
      join(ROOT, "config"),
      "--chain_id",
      CHAIN_ID,
      "--oracle_address",
      ORACLE_ADDRESS,
    ]),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as { ok: boolean; packed_hex: string; payload: { publication_group: string } };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.publication_group, "CORE");
  assert.equal(parsed.packed_hex.startsWith("05"), true);
});

test("relayer CLI verify and submit, including simulation fail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-relay-"));
  const state = await openCoreCollection();
  const next = await collectIndices(state, ["0"]);
  const sealed = sealCollection(next, NOW);
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  const batchPath = join(dir, "batch.json");
  const signersPath = join(dir, "signers.json");
  writeFileSync(batchPath, `${JSON.stringify(sealed.batch, null, 2)}\n`);
  writeFileSync(signersPath, `${JSON.stringify(signerSet1of1(), null, 2)}\n`);

  const verified = await capture(() => runRelayerCli(["verify", "--batch", batchPath, "--signers", signersPath]));
  assert.equal(verified.code, 0);

  const submitted = await capture(() =>
    runRelayerCli(["submit", "--batch", batchPath, "--signers", signersPath], { rpc: createMockRpc() }),
  );
  assert.equal(submitted.code, 0);
  const submittedJson = JSON.parse(submitted.stdout) as { ok: boolean; packed_hex: string };
  assert.equal(submittedJson.packed_hex, sealed.batch.packed_hex);

  const failed = await capture(() =>
    runRelayerCli(["submit", "--batch", batchPath, "--signers", signersPath], {
      rpc: createFailingSimulateRpc("PAUSED"),
    }),
  );
  assert.equal(failed.code, 1);
  const failedJson = JSON.parse(failed.stdout) as { error_code: string };
  assert.equal(failedJson.error_code, "SIMULATE");
});

test("coordinator CLI collect then assemble", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-coord-"));
  const signersPath = join(dir, "signers.json");
  const statePath = join(dir, "state.json");
  const signaturePath = join(dir, "sig.json");
  writeFileSync(signersPath, `${JSON.stringify(signerSet1of1(), null, 2)}\n`);

  const candidate = await capture(() =>
    runCoordinatorCli([
      "candidate",
      "--group",
      "CORE",
      "--fixtures",
      FIXTURES_PATH,
      "--now",
      String(NOW),
      "--config",
      join(ROOT, "config"),
      "--chain_id",
      CHAIN_ID,
      "--oracle_address",
      ORACLE_ADDRESS,
      "--state",
      statePath,
      "--signers",
      signersPath,
    ]),
  );
  assert.equal(candidate.code, 0);

  const opened = JSON.parse(readFileSync(statePath, "utf8")) as CollectionState;
  writeFileSync(signaturePath, `${JSON.stringify(await signIndex(opened, "0"), null, 2)}\n`);

  const collected = await capture(() =>
    runCoordinatorCli(["collect", "--state", statePath, "--signature", signaturePath, "--now", String(NOW)]),
  );
  assert.equal(collected.code, 0);

  const assembled = await capture(() =>
    runCoordinatorCli(["assemble", "--state", statePath, "--now", String(NOW)]),
  );
  assert.equal(assembled.code, 0);
  const batch = JSON.parse(assembled.stdout) as { ok: boolean; batch: { packed_hex: string } };
  assert.equal(batch.ok, true);
  assert.equal(batch.batch.packed_hex.startsWith("05"), true);
});
