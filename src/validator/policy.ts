import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hashPolicySnapshot } from "../config/policy.js";
import { loadSnapshot, type RegisterSnapshot } from "../config/validate.js";
import { blake2b256Hex } from "../packing/pack.js";
import { ValidatorError } from "./errors.js";
import { TEZORACLE_VERSION } from "./version.js";

export function defaultConfigDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config");
}

export function pinSnapshot(configDir: string): { snapshot: RegisterSnapshot; policy_hash: string } {
  const { snapshot, errors } = loadSnapshot(configDir);
  if (errors.length > 0) {
    throw new ValidatorError(
      "POLICY_PIN",
      errors.map((error) => `${error.path}: ${error.message}`).join("; "),
    );
  }
  return { snapshot, policy_hash: policyHashHex(snapshot) };
}

export function policyHashHex(snapshot: RegisterSnapshot): string {
  return hashPolicySnapshot(snapshot);
}

export function softwareArtifactHash(): string {
  return blake2b256Hex(new TextEncoder().encode(`tezoracle-class-a/${TEZORACLE_VERSION}`));
}
