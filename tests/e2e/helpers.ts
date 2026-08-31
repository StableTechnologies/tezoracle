import { readFileSync } from "node:fs";

import { createMockTransport, loadFixtureMap, type HttpTransport, type MockFixture } from "../../src/validator/adapters/http.js";
import { signPackedPayload, type RoundState } from "../../src/validator/signer.js";
import { isRefusalCode, ValidatorError } from "../../src/validator/errors.js";
import { createSignerHandlers } from "../../src/deploy/signer.js";
import { createOracleHarness } from "../../src/runtime/oracle.js";
import { runTick } from "../../src/runtime/tick.js";
import type { SignCandidate, TickDeps, TickResult } from "../../src/runtime/types.js";
import {
  CHAIN_ID,
  CONFIG_DIR,
  FIXTURES_PATH,
  NOW,
  ORACLE_ADDRESS,
  TRANSPORT_SIGNERS,
  signerSet1of1,
} from "../transport/helpers.js";

export { CHAIN_ID, CONFIG_DIR, NOW, ORACLE_ADDRESS, TRANSPORT_SIGNERS, signerSet1of1 };
export { signerSet3of4 } from "../transport/helpers.js";

const CORE_SIGNER = TRANSPORT_SIGNERS[0];
if (!CORE_SIGNER) throw new Error("missing transport signer 0");
export const CLASS_A_SIGNER = CORE_SIGNER;

function shiftTimestamps(value: unknown, deltaSeconds: number): unknown {
  if (typeof value === "number") {
    if (value > 1e12) return value + deltaSeconds * 1000;
    if (value > 1e9) return value + deltaSeconds;
    return value;
  }
  if (typeof value === "string") {
    if (/^\d{13}$/.test(value)) return String(Number(value) + deltaSeconds * 1000);
    if (/^\d{10}(\.\d+)?$/.test(value)) return String(Number(value) + deltaSeconds);
    if (value.includes("T") && !Number.isNaN(Date.parse(value))) {
      return new Date(Date.parse(value) + deltaSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => shiftTimestamps(entry, deltaSeconds));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, shiftTimestamps(child, deltaSeconds)]),
    );
  }
  return value;
}

export function coreMockTransportAt(now: number): HttpTransport {
  const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Record<string, MockFixture>;
  const shifted = shiftTimestamps(raw, now - NOW) as Record<string, MockFixture>;
  return createMockTransport(loadFixtureMap(shifted));
}

export function localSign(state: RoundState = {}): SignCandidate {
  return async (args) => {
    const signed = await signPackedPayload({
      payload: args.candidate.payload,
      secretKey: CLASS_A_SIGNER.secret_key,
      signerId: "class-a",
      state,
      now: args.now,
    });
    state[args.candidate.payload.publication_group] = args.candidate.payload.round;
    return {
      index: args.index,
      public_key: signed.public_key,
      signature: signed.signature.edsig,
      packed_hex: signed.packed_hex,
    };
  };
}

export function verifyingSign(args: { now: () => number; transport?: HttpTransport; statePath?: string }): SignCandidate {
  const classA = createSignerHandlers({
    configDir: CONFIG_DIR,
    transport: args.transport ?? coreMockTransportAt(args.now()),
    now: args.now,
    secretProvider: async () => CLASS_A_SIGNER.secret_key,
  });
  return async (input) => {
    const signed = await classA.sign({
      candidate: input.candidate,
      index: input.index,
      state_path: args.statePath,
    });
    if (signed.ok !== true) {
      const code = typeof signed.error_code === "string" && isRefusalCode(signed.error_code) ? signed.error_code : "INTERNAL";
      throw new ValidatorError(code, typeof signed.detail === "string" ? signed.detail : "Class A refused to sign");
    }
    return {
      index: typeof signed.index === "string" ? signed.index : input.index,
      public_key: String(signed.public_key),
      signature: String(signed.signature),
      packed_hex: String(signed.packed_hex),
    };
  };
}

export function tickHarness(args?: { now?: number; group?: string }) {
  const now = args?.now ?? NOW;
  const harness = createOracleHarness({
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
    activation_delay_levels: 1,
    level: 1,
    now,
  });
  return harness;
}

export function baseTickDeps(args?: {
  now?: () => number;
  group?: string;
  harness?: ReturnType<typeof tickHarness>;
  sign?: SignCandidate;
  signerSet?: TickDeps["signerSet"];
  transport?: HttpTransport;
}): TickDeps {
  const clock = args?.now ?? ((): number => NOW);
  const harness = args?.harness ?? tickHarness({ now: clock() });
  harness.setNow(clock());
  return {
    configDir: CONFIG_DIR,
    transport: args?.transport ?? coreMockTransportAt(clock()),
    rpc: harness,
    oracle: harness,
    signerSet: args?.signerSet ?? signerSet1of1(),
    sign: args?.sign ?? localSign(),
    now: clock,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
    group: args?.group ?? "CORE",
    signerIndex: "0",
  };
}

export async function publishedTick(args?: Parameters<typeof baseTickDeps>[0]): Promise<{
  result: TickResult;
  harness: ReturnType<typeof tickHarness>;
}> {
  const harness = args?.harness ?? tickHarness({ now: (args?.now ?? ((): number => NOW))() });
  const result = await runTick(baseTickDeps({ ...args, harness }));
  return { result, harness };
}
