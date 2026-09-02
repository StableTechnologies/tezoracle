import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMockTransport, defaultHttpTransport, loadFixtureMap, type HttpTransport } from "./adapters/http.js";
import { createTzktPoolRpcClient } from "./adapters/dex/tzkt_rpc.js";
import { createFilePoolSampleStore, type PoolSampleStore } from "./adapters/dex/state.js";
import { candidateFromDerivation, verifyCandidate } from "./candidate.js";
import { derivePublicationGroup } from "./derive.js";
import { ValidatorError } from "./errors.js";
import { defaultConfigDir, pinSnapshot } from "./policy.js";
import { commitRound, loadRoundState, saveRoundState, signPackedPayload } from "./signer.js";
import type { PublicationGroup } from "../packing/types.js";

type Flags = {
  command?: string;
  config: string;
  group: PublicationGroup;
  fixtures?: string;
  candidate?: string;
  now?: string;
  round: string;
  output?: string;
  state?: string;
  dexState?: string;
  retries: number;
  retryDelayMs: number;
  help?: boolean;
};

// Refusal codes that can plausibly clear up on their own within a few
// seconds (a slow venue, a momentarily thin quorum) as opposed to codes
// that reflect a real, stable policy or data problem retrying won't fix.
const RETRYABLE_DERIVE_CODES = new Set(["INSUFFICIENT", "TIMEOUT", "HTTP_STATUS"]);

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function usage(): string {
  return `TezOracle Class A validator (non-production)

Usage:
  tezoracle-validator derive  --group CORE [--config dir] [--fixtures file] [--now unix] [--round n] [--dex-state file] [--retries n] [--retry-delay-ms ms]
  tezoracle-validator verify  --candidate file [--config dir] [--fixtures file] [--now unix] [--dex-state file]
  tezoracle-validator sign    --candidate file [--config dir] [--fixtures file] [--now unix] [--state file] [--dex-state file]

Environment:
  TEZORACLE_SIGNER_SECRET_KEY   testnet edsk... (sign only)
  TEZORACLE_SIGNER_ID           signer-local id (default class-a)
  TEZORACLE_ROUND_STATE_PATH    last-signed-round JSON
  TEZOS_CHAIN_ID / ORACLE_ADDRESS   used when derive emits a payload

--dex-state persists raw DEX pool reserve samples between derive calls
(needed for USDTZ/TZBTC's locally-computed TWAP); pool storage is read
from TzKT (https://api.tzkt.io), reusing --fixtures when supplied.
verify/sign re-derive locally to cross-check the candidate, so USDTZ/TZBTC
candidates need the SAME --dex-state file used to produce them.

--retries (default 0) re-attempts a failed derive on transient refusal
codes only (INSUFFICIENT, TIMEOUT, HTTP_STATUS), waiting --retry-delay-ms
(default 2000) between attempts. Other refusal codes (BOUNDS, PAUSED,
POLICY_PIN, ...) never retry. Ignored when --now is explicitly given, so
deterministic/fixture-driven runs stay deterministic.
`;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    config: defaultConfigDir(),
    group: "CORE",
    round: "1",
    retries: 0,
    retryDelayMs: 2_000,
  };
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
        throw new ValidatorError("INTERNAL", `missing value for --${key}`);
      }
      i += 1;
      if (key === "config") {
        flags.config = value;
        continue;
      }
      if (
        key === "fixtures" ||
        key === "candidate" ||
        key === "now" ||
        key === "output" ||
        key === "state" ||
        key === "round"
      ) {
        flags[key] = value;
        continue;
      }
      if (key === "dex-state") {
        flags.dexState = value;
        continue;
      }
      if (key === "retries" || key === "retry-delay-ms") {
        if (!/^[0-9]+$/.test(value)) {
          throw new ValidatorError("INTERNAL", `--${key} must be a non-negative integer`);
        }
        if (key === "retries") flags.retries = Number(value);
        else flags.retryDelayMs = Number(value);
        continue;
      }
      if (key === "group") {
        if (value !== "CORE" && value !== "USDTZ" && value !== "TZBTC") {
          throw new ValidatorError("POLICY_PIN", "group must be CORE, USDTZ, or TZBTC");
        }
        flags.group = value;
        continue;
      }
      throw new ValidatorError("POLICY_PIN", `unknown flag --${key}`);
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

function dexStateStoreFromFlags(flags: Flags): PoolSampleStore | undefined {
  return flags.dexState ? createFilePoolSampleStore(flags.dexState) : undefined;
}

function nowFromFlags(flags: Flags): number {
  if (flags.now !== undefined) {
    if (!/^[1-9][0-9]*$/.test(flags.now)) {
      throw new ValidatorError("BAD_TIMESTAMP", "--now must be a positive Unix-seconds string");
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

export async function runCli(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.help || !flags.command) {
    process.stdout.write(usage());
    return flags.help ? 0 : 2;
  }
  const { snapshot } = pinSnapshot(flags.config);
  const transport = transportFromFlags(flags);
  const now = nowFromFlags(flags);

  if (flags.command === "derive") {
    // --now fixes wall-clock time for deterministic/fixture-driven runs;
    // retrying with the same frozen `now` would just repeat the same
    // failure, so retries only apply when the caller lets time move.
    const canRetryOverTime = flags.now === undefined;
    let attempt = 0;
    let derivation;
    let derivedNow = now;
    for (;;) {
      derivedNow = attempt === 0 ? now : nowFromFlags(flags);
      try {
        derivation = await derivePublicationGroup({
          snapshot,
          group: flags.group,
          transport,
          now: derivedNow,
          round: flags.round,
          poolRpc: createTzktPoolRpcClient({ transport }),
          dexStateStore: dexStateStoreFromFlags(flags),
        });
        break;
      } catch (error) {
        const retryable =
          canRetryOverTime &&
          attempt < flags.retries &&
          error instanceof ValidatorError &&
          RETRYABLE_DERIVE_CODES.has(error.code);
        if (!retryable) throw error;
        // error.message already includes "<code>: <detail>" (see ValidatorError) --
        // the detail matters here since INSUFFICIENT can mean "CEX quorum for
        // XTZ_USD isn't ready" (no DEX pool fetch happened yet) as much as it
        // can mean "DEX TWAP window hasn't accumulated enough samples".
        process.stderr.write(
          `derive attempt ${attempt + 1}/${flags.retries + 1} failed (${(error as ValidatorError).message}); retrying in ${flags.retryDelayMs}ms\n`,
        );
        await sleep(flags.retryDelayMs);
        attempt += 1;
      }
    }
    const chain_id = process.env.TEZOS_CHAIN_ID;
    const oracle_address = process.env.ORACLE_ADDRESS;
    if (chain_id && oracle_address) {
      const window = snapshot.register.time_policy.validity_window_seconds;
      const candidate = candidateFromDerivation({
        derivation,
        chain_id,
        oracle_address,
        round: flags.round,
        valid_from: String(derivedNow),
        valid_until: String(derivedNow + window),
      });
      // --output (or stdout when absent) gets the bare {payload, evidence} document
      // so it can be piped straight into `verify`/`sign --candidate`; the summary
      // always goes to stderr so stdout stays a clean, pipeable JSON document.
      writeOutput(flags, candidate);
      process.stderr.write(
        `${JSON.stringify(
          {
            ok: true,
            evidence_digest: candidate.payload.evidence_digest,
            assets: derivation.assets.map((asset) => ({
              asset_id: asset.asset_id,
              price: asset.price.toString(),
              decimals: asset.decimals,
              observation_time: asset.observation_time,
              contributing_source_ids: asset.sources.map((source) => source.source_id),
            })),
          },
          null,
          2,
        )}\n`,
      );
    } else {
      writeOutput(flags, {
        ok: true,
        group: derivation.group,
        policy_hash: derivation.policy_hash,
        evidence_digest: derivation.evidence_digest,
        assets: derivation.assets.map((asset) => ({
          asset_id: asset.asset_id,
          price: asset.price.toString(),
          decimals: asset.decimals,
          observation_time: asset.observation_time,
          contributing_source_ids: asset.sources.map((source) => source.source_id),
        })),
        evidence: derivation.evidence,
      });
    }
    return 0;
  }

  if (flags.command === "verify" || flags.command === "sign") {
    if (!flags.candidate) {
      throw new ValidatorError("POLICY_PIN", "--candidate is required");
    }
    const candidate = JSON.parse(readFileSync(flags.candidate, "utf8")) as unknown;
    const verified = await verifyCandidate({
      snapshot,
      candidate,
      transport,
      now,
      poolRpc: createTzktPoolRpcClient({ transport }),
      dexStateStore: dexStateStoreFromFlags(flags),
    });
    if (!verified.ok) {
      writeOutput(flags, { ok: false, error_code: verified.code, detail: verified.detail });
      return 1;
    }
    if (flags.command === "verify") {
      writeOutput(flags, {
        ok: true,
        evidence_digest: verified.evidence_digest,
        deviation_bps_by_asset: verified.deviation_bps_by_asset,
      });
      return 0;
    }
    const secret = process.env.TEZORACLE_SIGNER_SECRET_KEY;
    if (!secret) {
      throw new ValidatorError("INTERNAL", "TEZORACLE_SIGNER_SECRET_KEY is required to sign");
    }
    const statePath = flags.state ?? process.env.TEZORACLE_ROUND_STATE_PATH;
    const state = loadRoundState(statePath);
    const signed = await signPackedPayload({
      payload: verified.payload,
      secretKey: secret,
      signerId: process.env.TEZORACLE_SIGNER_ID ?? "class-a",
      state,
      now,
      localPrices: Object.fromEntries(verified.local.assets.map((asset) => [asset.asset_id, asset.price.toString()])),
      localTimes: Object.fromEntries(verified.local.assets.map((asset) => [asset.asset_id, asset.observation_time])),
      deviationBps: verified.deviation_bps_by_asset,
      localSources: verified.local.assets.flatMap((asset) => asset.sources),
    });
    if (statePath) {
      saveRoundState(statePath, commitRound(state, verified.payload.publication_group, verified.payload.round));
    }
    writeOutput(flags, {
      ok: true,
      payload: signed.payload,
      packed_hex: signed.packed_hex,
      signature: signed.signature,
      public_key: signed.public_key,
      local_record: signed.local_record,
    });
    return 0;
  }

  throw new ValidatorError("INTERNAL", `unknown command ${flags.command}`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const code = error instanceof ValidatorError ? error.code : "INTERNAL";
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ ok: false, error_code: code, detail })}\n`);
      process.exitCode = 1;
    });
}
