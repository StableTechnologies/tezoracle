import { pinSnapshot } from "../validator/policy.js";
import { CoordinatorError } from "./errors.js";
import { assertNoOracleSigningKeys } from "./keys.js";
import { ROUND_REQUEST_DOMAIN, type RoundRequest } from "./types.js";

const GROUP = /^[A-Z][A-Z0-9_]*$/;
const NAT = /^[1-9][0-9]*$/;

export function triggerRound(args: {
  configDir: string;
  group: string;
  round?: string;
  now: number;
  chain_id: string;
  oracle_address: string;
  collect_timeout_seconds?: number;
}): RoundRequest {
  assertNoOracleSigningKeys(args, "round trigger");
  if (!GROUP.test(args.group)) {
    throw new CoordinatorError("POLICY_PIN", "publication_group must match the register naming rule");
  }
  const { snapshot, policy_hash } = pinSnapshot(args.configDir);
  if (!(args.group in snapshot.register.publication_groups)) {
    throw new CoordinatorError("POLICY_PIN", `unknown publication group ${args.group}`);
  }
  const round = args.round ?? "1";
  if (!NAT.test(round)) {
    throw new CoordinatorError("INTERNAL", "round must be a positive decimal string");
  }
  const window = snapshot.register.time_policy.validity_window_seconds;
  const collectTimeout = args.collect_timeout_seconds ?? window;
  if (collectTimeout < 1) {
    throw new CoordinatorError("INTERNAL", "collect timeout must be at least 1 second");
  }
  const request: RoundRequest = {
    domain: ROUND_REQUEST_DOMAIN,
    publication_group: args.group,
    round,
    chain_id: args.chain_id,
    oracle_address: args.oracle_address,
    config_version: String(snapshot.register.config_version),
    policy_hash,
    valid_from: String(args.now),
    valid_until: String(args.now + window),
    collect_until: String(args.now + collectTimeout),
    created_at: args.now,
  };
  assertNoOracleSigningKeys(request, "round request");
  return request;
}
