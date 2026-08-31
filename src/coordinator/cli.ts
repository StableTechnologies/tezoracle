import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMockTransport, defaultHttpTransport, loadFixtureMap, type HttpTransport } from "../validator/adapters/http.js";
import { defaultConfigDir } from "../validator/policy.js";
import { parseSignerSet } from "../relayer/signers.js";
import { assembleCandidate } from "./candidate.js";
import { closeIncomplete, collectSignature, openCollection, parseIncomingSignature, sealCollection } from "./collect.js";
import { CoordinatorError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import { triggerRound } from "./round.js";
import type { CollectionState } from "./types.js";

type Flags = {
  command?: string;
  config: string;
  group: string;
  fixtures?: string;
  now?: string;
  round: string;
  output?: string;
  state?: string;
  signature?: string;
  signers?: string;
  index?: string;
  chain_id?: string;
  oracle_address?: string;
  collect_timeout?: string;
  close?: boolean;
  help?: boolean;
};

function usage(): string {
  return `TezOracle coordinator (non-authoritative; holds no keys)

Usage:
  tezoracle-coordinator trigger    --group CORE [--round n] [--now unix] [--config dir]
  tezoracle-coordinator candidate  --group CORE [--round n] [--fixtures file] [--now unix] [--config dir] [--state file]
  tezoracle-coordinator collect    --state file --signature file [--index n] [--now unix]
  tezoracle-coordinator assemble   --state file [--now unix] [--close]

Environment:
  TEZOS_CHAIN_ID / ORACLE_ADDRESS   domain-separation fields (not policy)
The coordinator never reads TEZORACLE_SIGNER_SECRET_KEY.
`;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    config: defaultConfigDir(),
    group: "CORE",
    round: "1",
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "--close") {
      flags.close = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CoordinatorError("INTERNAL", `missing value for --${key}`);
      }
      i += 1;
      if (
        key === "config" ||
        key === "fixtures" ||
        key === "now" ||
        key === "output" ||
        key === "state" ||
        key === "round" ||
        key === "signature" ||
        key === "signers" ||
        key === "index" ||
        key === "chain_id" ||
        key === "oracle_address" ||
        key === "collect_timeout" ||
        key === "group"
      ) {
        flags[key] = value;
        continue;
      }
      throw new CoordinatorError("POLICY_PIN", `unknown flag --${key}`);
    }
    positional.push(arg);
  }
  flags.command = positional[0];
  return flags;
}

function transportFromFlags(flags: Flags): HttpTransport {
  if (!flags.fixtures) return defaultHttpTransport;
  const raw = JSON.parse(readFileSync(flags.fixtures, "utf8")) as unknown;
  return createMockTransport(loadFixtureMap(raw));
}

function nowFromFlags(flags: Flags): number {
  if (flags.now !== undefined) {
    if (!/^[1-9][0-9]*$/.test(flags.now)) {
      throw new CoordinatorError("INTERNAL", "--now must be a positive Unix-seconds string");
    }
    return Number(flags.now);
  }
  return Math.floor(Date.now() / 1000);
}

function writeOutput(flags: Flags, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (flags.output) writeFileSync(flags.output, text);
  else process.stdout.write(text);
}

function loadState(path: string): CollectionState {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  assertNoOracleSigningKeys(raw, "collection state");
  return raw as CollectionState;
}

function saveState(path: string, state: CollectionState): void {
  assertNoOracleSigningKeys(state, "collection state");
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function chainAndOracle(flags: Flags): { chain_id: string; oracle_address: string } {
  const chain_id = flags.chain_id ?? process.env.TEZOS_CHAIN_ID;
  const oracle_address = flags.oracle_address ?? process.env.ORACLE_ADDRESS;
  if (!chain_id || !oracle_address) {
    throw new CoordinatorError("INTERNAL", "TEZOS_CHAIN_ID and ORACLE_ADDRESS are required to trigger a round");
  }
  return { chain_id, oracle_address };
}

export async function runCli(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.help || !flags.command) {
    process.stdout.write(usage());
    return flags.help ? 0 : 2;
  }
  const now = nowFromFlags(flags);

  if (flags.command === "trigger") {
    const { chain_id, oracle_address } = chainAndOracle(flags);
    const request = triggerRound({
      configDir: flags.config,
      group: flags.group,
      round: flags.round,
      now,
      chain_id,
      oracle_address,
      collect_timeout_seconds: flags.collect_timeout !== undefined ? Number(flags.collect_timeout) : undefined,
    });
    writeOutput(flags, { ok: true, request });
    return 0;
  }

  if (flags.command === "candidate") {
    const { chain_id, oracle_address } = chainAndOracle(flags);
    const request = triggerRound({
      configDir: flags.config,
      group: flags.group,
      round: flags.round,
      now,
      chain_id,
      oracle_address,
      collect_timeout_seconds: flags.collect_timeout !== undefined ? Number(flags.collect_timeout) : undefined,
    });
    const assembled = await assembleCandidate({
      request,
      configDir: flags.config,
      transport: transportFromFlags(flags),
      now,
    });
    if (flags.state) {
      if (!flags.signers) {
        throw new CoordinatorError("INTERNAL", "--signers is required when writing collection state");
      }
      const signerSet = parseSignerSet(JSON.parse(readFileSync(flags.signers, "utf8")) as unknown);
      const state = openCollection({
        request: assembled.request,
        candidate: assembled.candidate,
        packed_hex: assembled.packed_hex,
        signerSet,
      });
      saveState(flags.state, state);
    }
    writeOutput(flags, {
      ok: true,
      request: assembled.request,
      payload: assembled.candidate.payload,
      evidence: assembled.candidate.evidence,
      packed_hex: assembled.packed_hex,
    });
    return 0;
  }

  if (flags.command === "collect") {
    if (!flags.state || !flags.signature) {
      throw new CoordinatorError("INTERNAL", "--state and --signature are required");
    }
    const state = loadState(flags.state);
    const incoming = parseIncomingSignature(JSON.parse(readFileSync(flags.signature, "utf8")) as unknown, flags.index);
    const next = collectSignature(state, incoming, now);
    saveState(flags.state, next);
    writeOutput(flags, {
      ok: true,
      status: next.status,
      signature_count: next.signatures.length,
      packed_hex: next.packed_hex,
    });
    return next.status === "timeout" ? 1 : 0;
  }

  if (flags.command === "assemble") {
    if (!flags.state) {
      throw new CoordinatorError("INTERNAL", "--state is required");
    }
    let state = loadState(flags.state);
    if (flags.close) state = closeIncomplete(state);
    const sealed = sealCollection(state, now);
    if (sealed.ok) {
      writeOutput(flags, { ok: true, status: sealed.status, batch: sealed.batch, packed_hex: sealed.packed_hex });
      return 0;
    }
    writeOutput(flags, {
      ok: false,
      status: sealed.status,
      error_code: sealed.code,
      detail: sealed.detail,
      packed_hex: sealed.packed_hex,
      signature_count: sealed.signature_count,
    });
    return 1;
  }

  throw new CoordinatorError("INTERNAL", `unknown command ${flags.command}`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const code = error instanceof CoordinatorError ? error.code : "INTERNAL";
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error_code: code, detail })}\n`);
      process.exitCode = 1;
    });
}
