import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCommittedRegister } from "../../src/config/policy.js";
import { packConfigIntent } from "../../src/packing/governance.js";
import {
  buildPinnedInit,
  loadGovernanceSidecar,
  sidecarPathForVersion,
} from "../../src/validator/governance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Local `sls package` from the repository root. No AWS credentials and no
 * `sls deploy`. Catches a nested serviceDir (handlers/config missing) and a
 * Framework 4 CLI against frameworkVersion 3.
 */
test("serverless package from the repo root resolves handlers and config", () => {
  const home = join(ROOT, ".tmp", "sls-home");
  mkdirSync(home, { recursive: true });
  const configDir = join(ROOT, "config");
  const governanceDir = join(configDir, "governance");
  const { snapshot } = loadCommittedRegister(configDir);
  const sidecar = loadGovernanceSidecar(
    sidecarPathForVersion(configDir, snapshot.register.config_version),
  );
  const intentValue = {
    domain: "TEZORACLE_CONFIG_V1" as const,
    chain_id: "NetXsqzbfFenSTS",
    oracle_address: "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy",
    current_config_version: String(snapshot.register.config_version - 1),
    governance_nonce: "0",
    valid_until: String(Math.floor(Date.now() / 1000) + 3600),
    init: buildPinnedInit(snapshot, sidecar),
  };
  const packed = packConfigIntent(intentValue);
  const intent = `${JSON.stringify({ intent: intentValue, packed_hex: packed.packedHex })}\n`;
  mkdirSync(governanceDir, { recursive: true });
  writeFileSync(join(governanceDir, "intent.json"), intent);
  writeFileSync(
    join(governanceDir, "manifest.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        intent_sha256: createHash("sha256").update(intent).digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
  try {
    const sidecarCheck = spawnSync(
      process.execPath,
      ["--import", "tsx", join(ROOT, "scripts", "freeze-governance-deployment.ts"), "--check-sidecar"],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (sidecarCheck.status !== 0) assert.fail(`${sidecarCheck.stderr}\n${sidecarCheck.stdout}`);
    const checked = spawnSync(
      process.execPath,
      ["--import", "tsx", join(ROOT, "scripts", "freeze-governance-deployment.ts"), "--check"],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (checked.status !== 0) assert.fail(`${checked.stderr}\n${checked.stdout}`);
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
    const governanceZip = join(ROOT, ".serverless", "signerGovernance.zip");
    assert.equal(existsSync(governanceZip), true);
    const listing = execFileSync("unzip", ["-Z", "-1", zip], { encoding: "utf8" });
    assert.match(listing, /^config\/register\.json$/m);
    assert.match(listing, /src\/deploy\/coordinator\.mjs/);
    const governanceListing = execFileSync("unzip", ["-Z", "-1", governanceZip], {
      encoding: "utf8",
    });
    assert.match(governanceListing, /^config\/governance\/intent\.json$/m);
    assert.match(
      governanceListing,
      new RegExp(`^config/governance/v${snapshot.register.config_version}/sidecar\\.json$`, "m"),
    );
    assert.match(governanceListing, /^config\/governance\/manifest\.json$/m);
  } finally {
    for (const name of ["intent.json", "manifest.json"]) {
      rmSync(join(governanceDir, name), { force: true });
    }
  }
});
