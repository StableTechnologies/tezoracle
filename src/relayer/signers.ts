import { RelayerError } from "./errors.js";
import { MAX_SIGNERS, type SignerRecord, type SignerSet } from "./types.js";

const NAT = /^(0|[1-9][0-9]*)$/;
const EDPK = /^edpk[1-9A-HJ-NP-Za-km-z]+$/;
const SIGNER_SET_KEYS = ["threshold_n", "threshold_m", "class_minima", "signers"] as const;
const SIGNER_KEYS = ["index", "public_key", "class_id", "active"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

export function parseSignerSet(raw: unknown): SignerSet {
  if (!isObject(raw)) {
    throw new RelayerError("INTERNAL", "signer set must be an object");
  }
  const extra = extraKeys(raw, SIGNER_SET_KEYS);
  if (extra.length > 0) {
    throw new RelayerError("INTERNAL", `unknown signer-set field(s) ${extra.join(", ")}`);
  }
  if (
    typeof raw.threshold_n !== "number" ||
    typeof raw.threshold_m !== "number" ||
    !Number.isInteger(raw.threshold_n) ||
    !Number.isInteger(raw.threshold_m)
  ) {
    throw new RelayerError("QUORUM", "threshold_n and threshold_m must be integers");
  }
  if (!isObject(raw.class_minima) || Array.isArray(raw.class_minima)) {
    throw new RelayerError("CLASS_MIN", "class_minima must be an object");
  }
  if (!Array.isArray(raw.signers)) {
    throw new RelayerError("INTERNAL", "signers must be an array");
  }
  const class_minima: Record<string, number> = {};
  for (const [classId, minimum] of Object.entries(raw.class_minima)) {
    if (typeof classId !== "string" || classId.length === 0) {
      throw new RelayerError("CLASS_MIN", "class_id must be a non-empty string");
    }
    if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) {
      throw new RelayerError("CLASS_MIN", `class minimum for ${classId} must be a non-negative integer`);
    }
    class_minima[classId] = minimum;
  }
  const signers = raw.signers.map(parseSignerRecord);
  const set: SignerSet = {
    threshold_n: raw.threshold_n,
    threshold_m: raw.threshold_m,
    class_minima,
    signers,
  };
  assertSignerSet(set);
  return set;
}

function parseSignerRecord(raw: unknown, position: number): SignerRecord {
  if (!isObject(raw)) {
    throw new RelayerError("INTERNAL", `signer ${position} must be an object`);
  }
  const extra = extraKeys(raw, SIGNER_KEYS);
  if (extra.length > 0) {
    throw new RelayerError("INTERNAL", `unknown signer field(s) ${extra.join(", ")}`);
  }
  if (typeof raw.index !== "string" || !NAT.test(raw.index)) {
    throw new RelayerError("UNKNOWN_SIGNER", "signer index must be an unsigned decimal string");
  }
  if (typeof raw.public_key !== "string" || !EDPK.test(raw.public_key)) {
    throw new RelayerError("INTERNAL", `signer ${raw.index} public_key is not a valid edpk`);
  }
  if (typeof raw.class_id !== "string" || raw.class_id.length === 0) {
    throw new RelayerError("CLASS_MIN", `signer ${raw.index} class_id must be a non-empty string`);
  }
  if (typeof raw.active !== "boolean") {
    throw new RelayerError("INACTIVE_SIGNER", `signer ${raw.index} active must be a boolean`);
  }
  return {
    index: raw.index,
    public_key: raw.public_key,
    class_id: raw.class_id,
    active: raw.active,
  };
}

export function assertSignerSet(set: SignerSet): void {
  const active = set.signers.filter((signer) => signer.active);
  if (set.threshold_n < 1 || set.threshold_m < 1 || set.threshold_n > set.threshold_m || set.threshold_m > MAX_SIGNERS) {
    throw new RelayerError("QUORUM", "require 1 ≤ N ≤ M ≤ 16");
  }
  if (set.threshold_m !== active.length) {
    throw new RelayerError("QUORUM", "threshold_m must equal the number of active signers");
  }
  if (set.signers.length > MAX_SIGNERS) {
    throw new RelayerError("QUORUM", "signer map exceeds 16");
  }
  const seenIndex = new Set<string>();
  const seenKey = new Set<string>();
  const classCount: Record<string, number> = {};
  for (const signer of set.signers) {
    if (seenIndex.has(signer.index)) {
      throw new RelayerError("DUPLICATE", `duplicate signer index ${signer.index}`);
    }
    seenIndex.add(signer.index);
    if (seenKey.has(signer.public_key)) {
      throw new RelayerError("DUPLICATE", "duplicate signer public key");
    }
    seenKey.add(signer.public_key);
    if (signer.active) {
      classCount[signer.class_id] = (classCount[signer.class_id] ?? 0) + 1;
    }
  }
  let minimaSum = 0;
  for (const [classId, minimum] of Object.entries(set.class_minima)) {
    const available = classCount[classId] ?? 0;
    if (minimum > available) {
      throw new RelayerError("CLASS_MIN", `class ${classId} minimum ${minimum} exceeds active count ${available}`);
    }
    minimaSum += minimum;
  }
  if (minimaSum > set.threshold_n) {
    throw new RelayerError("CLASS_MIN", "sum of class minima exceeds N");
  }
}

export function lookupSigner(set: SignerSet, index: string): SignerRecord {
  const signer = set.signers.find((entry) => entry.index === index);
  if (!signer) {
    throw new RelayerError("UNKNOWN_SIGNER", `index ${index} is not in the signer set`);
  }
  if (!signer.active) {
    throw new RelayerError("INACTIVE_SIGNER", `index ${index} is inactive`);
  }
  return signer;
}

export function oneOfOne(signer: Omit<SignerRecord, "active">): SignerSet {
  return {
    threshold_n: 1,
    threshold_m: 1,
    class_minima: { A: 0 },
    signers: [{ ...signer, active: true }],
  };
}

export function nOfM(args: {
  threshold_n: number;
  class_minima?: Record<string, number>;
  signers: Array<Omit<SignerRecord, "active"> & { active?: boolean }>;
}): SignerSet {
  const signers = args.signers.map((signer) => ({ ...signer, active: signer.active ?? true }));
  const set: SignerSet = {
    threshold_n: args.threshold_n,
    threshold_m: signers.filter((signer) => signer.active).length,
    class_minima: args.class_minima ?? { A: 0 },
    signers,
  };
  assertSignerSet(set);
  return set;
}
