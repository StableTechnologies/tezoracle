import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  parseGovernanceArtifact,
  parseGovernanceSidecar,
  rebuildAndPackGovernanceIntent,
  sidecarPathForVersion,
} from "../src/validator/governance.js";
import { pinSnapshot } from "../src/validator/policy.js";

const root = resolve(import.meta.dirname, "..");
const configDir = join(root, "config");
const directory = join(configDir, "governance");
const intentPath = join(directory, "intent.json");
const manifestPath = join(directory, "manifest.json");
const { snapshot } = pinSnapshot(configDir);
const sidecarPath = sidecarPathForVersion(configDir, snapshot.register.config_version);

function checkSidecar() {
  const sidecar = parseGovernanceSidecar(JSON.parse(readFileSync(sidecarPath, "utf8")) as unknown);
  if (BigInt(sidecar.threshold_m) < 1n) {
    throw new Error("committed sidecar threshold_m must be at least 1");
  }
  return sidecar;
}

const sidecar = checkSidecar();

if (process.argv.includes("--check-sidecar")) {
  process.stdout.write(`${sidecarPath}\n`);
  process.exit(0);
}

const intentBytes = readFileSync(intentPath);
const artifact = parseGovernanceArtifact(JSON.parse(intentBytes.toString("utf8")) as unknown);
rebuildAndPackGovernanceIntent({
  artifact,
  snapshot,
  sidecar,
  now: Math.floor(Date.now() / 1000),
});

const manifest = {
  schema_version: 1,
  intent_sha256: createHash("sha256").update(intentBytes).digest("hex"),
};
if (process.argv.includes("--check")) {
  const committed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (JSON.stringify(committed) !== JSON.stringify(manifest)) {
    throw new Error("governance deployment manifest does not match intent bytes");
  }
  process.stdout.write("governance deployment pins verified\n");
} else {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${manifestPath}\n`);
}
