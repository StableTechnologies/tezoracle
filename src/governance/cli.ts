import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CoordinatorError } from "../coordinator/errors.js";
import { assertNoOracleSigningKeys } from "../coordinator/keys.js";
import { parseSignerSet } from "../relayer/signers.js";
import {
  assembleGovernanceCall,
  collectGovernanceSignature,
  openGovernanceCollection,
  type GovernanceCollectionState,
  type IncomingGovernanceSignature,
} from "./collect.js";

type Flags = {
  command?: string;
  intent?: string;
  signers?: string;
  state?: string;
  signature?: string;
  collectUntil?: string;
  now?: string;
  output?: string;
  help?: boolean;
};

function usage(): string {
  return `TezOracle governance collector (holds no keys)

Usage:
  tezoracle-governance open     --intent artifact.json --signers signers.json --state state.json --collect-until unix
  tezoracle-governance collect  --state state.json --signature signature.json [--now unix]
  tezoracle-governance assemble --state state.json [--now unix] [--output call.json]
`;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CoordinatorError("INTERNAL", `missing value for ${arg}`);
    }
    i += 1;
    const key = arg.slice(2);
    if (key === "collect-until") flags.collectUntil = value;
    else if (
      key === "intent" ||
      key === "signers" ||
      key === "state" ||
      key === "signature" ||
      key === "now" ||
      key === "output"
    ) {
      flags[key] = value;
    } else {
      throw new CoordinatorError("INTERNAL", `unknown flag ${arg}`);
    }
  }
  flags.command = positional[0];
  return flags;
}

function json(path: string): unknown {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  assertNoOracleSigningKeys(value, path);
  return value;
}

function state(path: string): GovernanceCollectionState {
  return json(path) as GovernanceCollectionState;
}

function write(path: string | undefined, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (path) writeFileSync(path, text);
  else process.stdout.write(text);
}

function now(flags: Flags): number {
  if (flags.now === undefined) return Math.floor(Date.now() / 1000);
  if (!/^[1-9][0-9]*$/.test(flags.now)) {
    throw new CoordinatorError("INTERNAL", "--now must be positive Unix seconds");
  }
  return Number(flags.now);
}

export async function runGovernanceCli(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.help || !flags.command) {
    process.stdout.write(usage());
    return flags.help ? 0 : 2;
  }
  if (flags.command === "open") {
    if (!flags.intent || !flags.signers || !flags.state || !flags.collectUntil) {
      throw new CoordinatorError(
        "INTERNAL",
        "open requires --intent, --signers, --state, and --collect-until",
      );
    }
    const opened = openGovernanceCollection({
      artifact: json(flags.intent),
      signerSet: parseSignerSet(json(flags.signers)),
      collectUntil: flags.collectUntil,
    });
    write(flags.state, opened);
    write(flags.output, {
      ok: true,
      status: opened.status,
      packed_hex: opened.artifact.packed_hex,
      required_signatures: opened.signer_set.threshold_m,
    });
    return 0;
  }
  if (flags.command === "collect") {
    if (!flags.state || !flags.signature) {
      throw new CoordinatorError("INTERNAL", "collect requires --state and --signature");
    }
    const incoming = json(flags.signature) as IncomingGovernanceSignature;
    const next = collectGovernanceSignature(state(flags.state), incoming, now(flags));
    write(flags.state, next);
    write(flags.output, {
      ok: true,
      status: next.status,
      signature_count: next.signatures.length,
      required_signatures: next.signer_set.threshold_m,
    });
    return next.status === "timeout" ? 1 : 0;
  }
  if (flags.command === "assemble") {
    if (!flags.state) {
      throw new CoordinatorError("INTERNAL", "assemble requires --state");
    }
    const call = assembleGovernanceCall(state(flags.state), now(flags));
    write(flags.output, { ok: true, call });
    return 0;
  }
  throw new CoordinatorError("INTERNAL", `unknown command ${flags.command}`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  runGovernanceCli(process.argv.slice(2)).catch((error: unknown) => {
    const code = error instanceof CoordinatorError ? error.code : "INTERNAL";
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error_code: code, detail })}\n`);
    process.exitCode = 1;
  });
}
