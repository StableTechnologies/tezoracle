import type { Micheline } from "./types.js";
import type { LogicalAssetPolicy, LogicalInit, LogicalSigner } from "./governance_types.js";

const annot = (name: string): string[] => [`%${name}`];

export function pair(left: Micheline, right: Micheline): Micheline {
  return { prim: "Pair", args: [left, right] };
}

function combType(fields: { name: string; type: Micheline }[]): Micheline {
  if (fields.length < 2) {
    throw new Error("comb type requires at least two fields");
  }
  const last = fields[fields.length - 1]!;
  let acc: Micheline = { ...last.type, annots: annot(last.name) };
  for (let i = fields.length - 2; i >= 0; i--) {
    const field = fields[i]!;
    acc = {
      prim: "pair",
      args: [{ ...field.type, annots: annot(field.name) }, acc],
    };
  }
  return acc;
}

function combValue(values: Micheline[]): Micheline {
  if (values.length < 2) {
    throw new Error("comb value requires at least two fields");
  }
  let acc: Micheline = values[values.length - 1]!;
  for (let i = values.length - 2; i >= 0; i--) {
    acc = pair(values[i]!, acc);
  }
  return acc;
}

const SIGNER_TYPE = combType([
  { name: "public_key", type: { prim: "key" } },
  { name: "class_id", type: { prim: "string" } },
  { name: "active", type: { prim: "bool" } },
]);

const ASSET_POLICY_TYPE = combType([
  { name: "decimals", type: { prim: "nat" } },
  { name: "max_observation_age_seconds", type: { prim: "nat" } },
  { name: "absolute_min_price", type: { prim: "nat" } },
  { name: "absolute_max_price", type: { prim: "nat" } },
  { name: "max_movement_bps", type: { prim: "nat" } },
]);

export const INIT_MICHELSON_TYPE: Micheline = combType([
  { name: "activation_delay_levels", type: { prim: "nat" } },
  { name: "admin", type: { prim: "address" } },
  {
    name: "assets",
    type: { prim: "map", args: [{ prim: "string" }, ASSET_POLICY_TYPE] },
  },
  { name: "class_minima", type: { prim: "map", args: [{ prim: "string" }, { prim: "nat" }] } },
  { name: "config_version", type: { prim: "nat" } },
  {
    name: "groups",
    type: { prim: "map", args: [{ prim: "string" }, { prim: "list", args: [{ prim: "string" }] }] },
  },
  { name: "guardian", type: { prim: "address" } },
  { name: "max_clock_skew_seconds", type: { prim: "nat" } },
  { name: "min_activation_delay_levels", type: { prim: "nat" } },
  { name: "policy_hash", type: { prim: "bytes" } },
  { name: "price_nat_max", type: { prim: "nat" } },
  {
    name: "signers",
    type: { prim: "map", args: [{ prim: "nat" }, SIGNER_TYPE] },
  },
  { name: "threshold_m", type: { prim: "nat" } },
  { name: "threshold_n", type: { prim: "nat" } },
  { name: "validity_window_seconds", type: { prim: "nat" } },
]);

const PREFIX_FIELDS: { name: string; type: Micheline }[] = [
  { name: "domain", type: { prim: "string" } },
  { name: "chain_id", type: { prim: "chain_id" } },
  { name: "oracle_address", type: { prim: "address" } },
  { name: "current_config_version", type: { prim: "nat" } },
  { name: "governance_nonce", type: { prim: "nat" } },
  { name: "valid_until", type: { prim: "timestamp" } },
];

export const CONFIG_INTENT_MICHELSON_TYPE: Micheline = combType([
  ...PREFIX_FIELDS,
  { name: "init", type: INIT_MICHELSON_TYPE },
]);

export const SIMPLE_INTENT_MICHELSON_TYPE: Micheline = combType(PREFIX_FIELDS);

export const ASSET_INTENT_MICHELSON_TYPE: Micheline = combType([
  ...PREFIX_FIELDS,
  { name: "asset_id", type: { prim: "string" } },
]);

function boolMicheline(value: boolean): Micheline {
  return { prim: value ? "True" : "False" };
}

function natMicheline(value: string): Micheline {
  return { int: value };
}

function mapMicheline(elts: Micheline[]): Micheline {
  return elts;
}

function signerMicheline(signer: LogicalSigner): Micheline {
  return combValue([
    { string: signer.public_key },
    { string: signer.class_id },
    boolMicheline(signer.active),
  ]);
}

function assetPolicyMicheline(policy: LogicalAssetPolicy): Micheline {
  return combValue([
    natMicheline(policy.decimals),
    natMicheline(policy.max_observation_age_seconds),
    natMicheline(policy.absolute_min_price),
    natMicheline(policy.absolute_max_price),
    natMicheline(policy.max_movement_bps),
  ]);
}

function compareUtf8(a: string, b: string): number {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const lv = left[i]!;
    const rv = right[i]!;
    if (lv !== rv) return lv - rv;
  }
  return left.length - right.length;
}

export function initMicheline(init: LogicalInit): Micheline {
  const assets = Object.keys(init.assets)
    .sort(compareUtf8)
    .map((assetId) => ({
      prim: "Elt" as const,
      args: [{ string: assetId }, assetPolicyMicheline(init.assets[assetId]!)],
    }));
  const minima = Object.keys(init.class_minima)
    .sort(compareUtf8)
    .map((classId) => ({
      prim: "Elt" as const,
      args: [{ string: classId }, natMicheline(init.class_minima[classId]!)],
    }));
  const groups = Object.keys(init.groups)
    .sort(compareUtf8)
    .map((name) => ({
      prim: "Elt" as const,
      args: [{ string: name }, init.groups[name]!.map((id) => ({ string: id }))],
    }));
  const signers = Object.keys(init.signers)
    .sort((a, b) => {
      const d = BigInt(a) - BigInt(b);
      return d < 0n ? -1 : d > 0n ? 1 : 0;
    })
    .map((index) => ({
      prim: "Elt" as const,
      args: [natMicheline(index), signerMicheline(init.signers[index]!)],
    }));
  return combValue([
    natMicheline(init.activation_delay_levels),
    { string: init.admin },
    mapMicheline(assets),
    mapMicheline(minima),
    natMicheline(init.config_version),
    mapMicheline(groups),
    { string: init.guardian },
    natMicheline(init.max_clock_skew_seconds),
    natMicheline(init.min_activation_delay_levels),
    { bytes: init.policy_hash },
    natMicheline(init.price_nat_max),
    mapMicheline(signers),
    natMicheline(init.threshold_m),
    natMicheline(init.threshold_n),
    natMicheline(init.validity_window_seconds),
  ]);
}

function prefixMicheline(intent: {
  domain: string;
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
}): Micheline[] {
  return [
    { string: intent.domain },
    { string: intent.chain_id },
    { string: intent.oracle_address },
    natMicheline(intent.current_config_version),
    natMicheline(intent.governance_nonce),
    { int: intent.valid_until },
  ];
}

export function configIntentMicheline(intent: {
  domain: string;
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
  init: LogicalInit;
}): Micheline {
  return combValue([...prefixMicheline(intent), initMicheline(intent.init)]);
}

export function simpleIntentMicheline(intent: {
  domain: string;
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
}): Micheline {
  return combValue(prefixMicheline(intent));
}

export function assetIntentMicheline(intent: {
  domain: string;
  chain_id: string;
  oracle_address: string;
  current_config_version: string;
  governance_nonce: string;
  valid_until: string;
  asset_id: string;
}): Micheline {
  return combValue([...prefixMicheline(intent), { string: intent.asset_id }]);
}
