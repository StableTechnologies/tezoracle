import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../../src/validator/cli.js";
import { FIXTURES_PATH, NOW } from "./helpers.js";

test("CLI --help exits 0", async () => {
  const code = await runCli(["--help"]);
  assert.equal(code, 0);
});

test("CLI derive against deterministic fixtures prints CORE prices", async () => {
  const previous = process.stdout.write;
  let captured = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await runCli([
      "derive",
      "--group",
      "CORE",
      "--fixtures",
      FIXTURES_PATH,
      "--now",
      String(NOW),
    ]);
    assert.equal(code, 0);
    const parsed = JSON.parse(captured) as { ok: boolean; assets: { asset_id: string; price: string }[] };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.assets.find((asset) => asset.asset_id === "XTZ_USD")?.price, "750200");
  } finally {
    process.stdout.write = previous;
  }
});

test("CLI verify refuses a mutated candidate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tezoracle-"));
  const candidatePath = join(dir, "candidate.json");
  writeFileSync(
    candidatePath,
    JSON.stringify({
      payload: { domain: "TEZORACLE_V1" },
      evidence: { domain: "TEZORACLE_EVIDENCE_V1" },
      sources: [],
    }),
  );
  const previous = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    const code = await runCli(["verify", "--candidate", candidatePath, "--fixtures", FIXTURES_PATH, "--now", String(NOW)]);
    assert.equal(code, 1);
  } finally {
    process.stdout.write = previous;
  }
});
