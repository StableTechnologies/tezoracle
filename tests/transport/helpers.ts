import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { signPackedPayload } from "../../src/validator/signer.js";
import { assembleCandidate } from "../../src/coordinator/candidate.js";
import { collectSignature, openCollection } from "../../src/coordinator/collect.js";
import { triggerRound } from "../../src/coordinator/round.js";
import type { CollectionState } from "../../src/coordinator/types.js";
import { nOfM, oneOfOne, type SignerSet } from "../../src/relayer/index.js";
import { NOW, ROOT, coreMockTransport } from "../validator/helpers.js";

export { NOW, ROOT, CONFIG_DIR, FIXTURES_PATH, coreMockTransport, pinnedRegister } from "../validator/helpers.js";

export const CHAIN_ID = "NetXnHfVqm9iesp";
export const ORACLE_ADDRESS = "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy";

const transportKeys = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "keys.json"), "utf8"),
) as {
  signers: Array<{
    index: string;
    secret_key: string;
    public_key: string;
    public_key_hash: string;
    class_id: string;
  }>;
};

export const TRANSPORT_SIGNERS = transportKeys.signers;

export function signerSet1of1(): SignerSet {
  const signer = TRANSPORT_SIGNERS[0];
  if (!signer) throw new Error("missing transport signer 0");
  return oneOfOne({
    index: signer.index,
    public_key: signer.public_key,
    class_id: signer.class_id,
  });
}

export function signerSet3of4(): SignerSet {
  return nOfM({
    threshold_n: 3,
    class_minima: { A: 1, B: 1 },
    signers: TRANSPORT_SIGNERS.map((signer) => ({
      index: signer.index,
      public_key: signer.public_key,
      class_id: signer.class_id,
    })),
  });
}

export async function openCoreCollection(args?: {
  now?: number;
  round?: string;
  collect_timeout_seconds?: number;
  signerSet?: SignerSet;
}): Promise<CollectionState> {
  const now = args?.now ?? NOW;
  const request = triggerRound({
    configDir: join(ROOT, "config"),
    group: "CORE",
    round: args?.round ?? "1",
    now,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
    collect_timeout_seconds: args?.collect_timeout_seconds,
  });
  const assembled = await assembleCandidate({
    request,
    configDir: join(ROOT, "config"),
    transport: coreMockTransport(),
    now,
  });
  return openCollection({
    request: assembled.request,
    candidate: assembled.candidate,
    packed_hex: assembled.packed_hex,
    signerSet: args?.signerSet ?? signerSet1of1(),
  });
}

export async function signIndex(state: CollectionState, index: string) {
  const signer = TRANSPORT_SIGNERS.find((entry) => entry.index === index);
  if (!signer) throw new Error(`missing transport signer ${index}`);
  const signed = await signPackedPayload({
    payload: state.candidate.payload,
    secretKey: signer.secret_key,
    signerId: `transport-${index}`,
    state: {},
    now: NOW,
  });
  return {
    index,
    public_key: signed.public_key,
    signature: signed.signature.edsig,
    packed_hex: signed.packed_hex,
  };
}

export async function collectIndices(state: CollectionState, indices: string[], now = NOW): Promise<CollectionState> {
  let next = state;
  for (const index of indices) {
    next = collectSignature(next, await signIndex(next, index), now);
  }
  return next;
}
