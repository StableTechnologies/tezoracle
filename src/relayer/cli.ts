import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSignedBatch } from "./batch.js";
import { RelayerError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import { encodeSubmit, relaySignedBatch } from "./relay.js";
import { parseSignerSet } from "./signers.js";
import { verifySignedBatch } from "./verify.js";
import type { RelayRpc } from "./types.js";

type Flags = {
  command?: string;
  batch?: string;
  signers?: string;
  output?: string;
  help?: boolean;
};

function usage(): string {
  return `TezOracle permissionless relayer (holds no oracle keys; cannot mutate packed bytes)

Usage:
  tezoracle-relayer verify  --batch file --signers file
  tezoracle-relayer encode  --batch file --signers file
  tezoracle-relayer submit  --batch file --signers file

submit requires an injected RelayRpc (local e2e / test). The CLI never reads
TEZORACLE_SIGNER_SECRET_KEY. A backup relayer submits the same --batch file.
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
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new RelayerError("INTERNAL", `missing value for --${key}`);
      }
      i += 1;
      if (key === "batch" || key === "signers" || key === "output") {
        flags[key] = value;
        continue;
      }
      throw new RelayerError("INTERNAL", `unknown flag --${key}`);
    }
    positional.push(arg);
  }
  flags.command = positional[0];
  return flags;
}

function writeOutput(flags: Flags, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (flags.output) writeFileSync(flags.output, text);
  else process.stdout.write(text);
}

function loadInputs(flags: Flags) {
  if (!flags.batch || !flags.signers) {
    throw new RelayerError("INTERNAL", "--batch and --signers are required");
  }
  const batchRaw = JSON.parse(readFileSync(flags.batch, "utf8")) as unknown;
  const signersRaw = JSON.parse(readFileSync(flags.signers, "utf8")) as unknown;
  assertNoOracleSigningKeys(batchRaw, "relayer batch");
  assertNoOracleSigningKeys(signersRaw, "relayer signer set");
  return { batch: parseSignedBatch(batchRaw), signerSet: parseSignerSet(signersRaw) };
}

export async function runCli(argv: string[], deps: { rpc?: RelayRpc } = {}): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.help || !flags.command) {
    process.stdout.write(usage());
    return flags.help ? 0 : 2;
  }

  if (flags.command === "verify") {
    const { batch, signerSet } = loadInputs(flags);
    const verified = verifySignedBatch(batch, signerSet);
    if (!verified.ok) {
      writeOutput(flags, { ok: false, error_code: verified.code, detail: verified.detail });
      return 1;
    }
    writeOutput(flags, { ok: true, packed_hex: verified.packed_hex, signature_count: batch.signatures.length });
    return 0;
  }

  if (flags.command === "encode") {
    const { batch, signerSet } = loadInputs(flags);
    const call = encodeSubmit(batch, signerSet);
    writeOutput(flags, {
      ok: true,
      packed_hex: call.packed_hex,
      oracle_address: call.oracle_address,
      entrypoint: call.entrypoint,
      parameter: call.parameter,
    });
    return 0;
  }

  if (flags.command === "submit") {
    if (!deps.rpc) {
      throw new RelayerError("INTERNAL", "submit requires an injected RelayRpc (local e2e / test)");
    }
    const { batch, signerSet } = loadInputs(flags);
    const result = await relaySignedBatch({ batch, signerSet, rpc: deps.rpc });
    if (!result.ok) {
      writeOutput(flags, { ok: false, error_code: result.code, detail: result.detail, packed_hex: result.packed_hex });
      return 1;
    }
    writeOutput(flags, { ok: true, packed_hex: result.packed_hex, op_hash: result.op_hash, confirmed: true });
    return 0;
  }

  throw new RelayerError("INTERNAL", `unknown command ${flags.command}`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const code = error instanceof RelayerError ? error.code : "INTERNAL";
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error_code: code, detail })}\n`);
      process.exitCode = 1;
    });
}
