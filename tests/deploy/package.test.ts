import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Local `sls package` from the repository root. No AWS credentials and no
 * `sls deploy`. Catches a nested serviceDir (handlers/config missing) and a
 * Framework 4 CLI against frameworkVersion 3.
 */
test("serverless package from the repo root resolves handlers and config", () => {
  const home = join(ROOT, ".tmp", "sls-home");
  mkdirSync(home, { recursive: true });
  const result = spawnSync(join(ROOT, "node_modules", ".bin", "serverless"), ["package", "--stage", "testnet"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_DEFAULT_REGION: "us-east-1",
      SLS_TELEMETRY_DISABLED: "1",
      SLS_INTERACTIVE_SETUP_ENABLE: "0",
    },
  });
  if (result.status !== 0) {
    assert.fail(`${result.stderr}\n${result.stdout}`);
  }
  assert.match(`${result.stdout}\n${result.stderr}`, /tezoracle-testnet-shadow/i);
  const zip = join(ROOT, ".serverless", "coordinatorCandidate.zip");
  assert.equal(existsSync(zip), true);
  assert.equal(existsSync(join(ROOT, ".serverless", "signerClassA.zip")), true);
  const listing = execFileSync("unzip", ["-Z", "-1", zip], { encoding: "utf8" });
  assert.match(listing, /^config\/register\.json$/m);
  assert.match(listing, /src\/deploy\/coordinator\.mjs/);
});
