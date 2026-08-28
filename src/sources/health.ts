/**
 * Source reachability and production-quorum eligibility.
 *
 * Listing a URL in the parameter register is an allowlist identity, not a
 * health attestation. HTTP 451, timeouts, TLS failures, and untested
 * endpoints never count as healthy production sources.
 */

export type ProbeStatus = "untested" | "reachable" | "geo_blocked" | "failed";

export type KnownRestriction = "http_451";

export type SourceHealth = {
  probe_status: ProbeStatus;
  last_http_status: number | null;
  known_restriction?: KnownRestriction;
  eligible_for_production_quorum: boolean;
  notes?: string;
};

export type ProbeOutcome =
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

export type ProbeClass = "ok" | "geo_blocked" | "http_error" | "timeout" | "network";

export function classifyProbe(outcome: ProbeOutcome): ProbeClass {
  if (outcome.kind === "timeout") return "timeout";
  if (outcome.kind === "network") return "network";
  if (outcome.status === 451) return "geo_blocked";
  if (outcome.status >= 200 && outcome.status < 300) return "ok";
  return "http_error";
}

export function probeStatusFromOutcome(outcome: ProbeOutcome): ProbeStatus {
  const classified = classifyProbe(outcome);
  if (classified === "ok") return "reachable";
  if (classified === "geo_blocked") return "geo_blocked";
  return "failed";
}

export type QuorumEligibilityInput = {
  adapter_status: "initial_phase" | "stretch";
  health: SourceHealth;
  probe?: ProbeOutcome;
};

export type HealthGateCode = "UNAPPROVED_SOURCE" | "UNTESTED" | "HTTP_451" | "HTTP_STATUS" | "TIMEOUT" | "POLICY_PIN";

export type HealthGateDecision = { ok: true } | { ok: false; code: HealthGateCode; detail: string };

/**
 * Register health gate for derivation in every mode (testnet, shadow, production).
 * Untested, geo-blocked, stretch, and failed sources do not participate.
 * A live 2xx response does not override an untested register row: the snapshot
 * must be updated after a probe from the intended signer environment.
 */
export function registerDerivationGate(
  input: QuorumEligibilityInput,
  options: { production?: boolean } = {},
): HealthGateDecision {
  if (input.adapter_status !== "initial_phase") {
    return {
      ok: false,
      code: "UNAPPROVED_SOURCE",
      detail: "stretch sources do not count until an adapter is initial_phase",
    };
  }
  if (input.health.known_restriction === "http_451" || input.health.probe_status === "geo_blocked") {
    return {
      ok: false,
      code: "HTTP_451",
      detail: "register health: HTTP 451 / geo-blocked; not a healthy source",
    };
  }
  if (input.health.probe_status === "untested") {
    return {
      ok: false,
      code: "UNTESTED",
      detail: "untested endpoints must not count as healthy sources",
    };
  }
  if (input.health.probe_status !== "reachable") {
    return {
      ok: false,
      code: "HTTP_STATUS",
      detail: `register probe_status is ${input.health.probe_status}`,
    };
  }
  if (options.production && !countsTowardProductionQuorum(input)) {
    return {
      ok: false,
      code: "POLICY_PIN",
      detail: "source is not eligible_for_production_quorum",
    };
  }
  return { ok: true };
}

export function liveProbeGate(outcome: ProbeOutcome): HealthGateDecision {
  const classified = classifyProbe(outcome);
  if (classified === "ok") return { ok: true };
  if (classified === "geo_blocked") {
    return { ok: false, code: "HTTP_451", detail: "HTTP 451" };
  }
  if (classified === "timeout") {
    return { ok: false, code: "TIMEOUT", detail: "bounded HTTP timeout" };
  }
  if (classified === "network") {
    return { ok: false, code: "TIMEOUT", detail: "source unavailable" };
  }
  const status = outcome.kind === "http" ? outcome.status : 0;
  return { ok: false, code: "HTTP_STATUS", detail: `HTTP ${status}` };
}

/**
 * A source counts toward a production quorum only when it is an initial-phase
 * adapter, the register marks it production-eligible, and a live probe from
 * the signer environment succeeded. Untested, geo-blocked, stretch, and
 * failed sources are excluded. A 451 probe is fail-closed for that source.
 */
export function countsTowardProductionQuorum(input: QuorumEligibilityInput): boolean {
  if (input.adapter_status !== "initial_phase") return false;
  if (input.health.eligible_for_production_quorum !== true) return false;
  if (input.health.probe_status !== "reachable") return false;
  if (input.health.known_restriction === "http_451") return false;
  if (input.probe !== undefined) {
    return classifyProbe(input.probe) === "ok";
  }
  return true;
}

/**
 * Runtime observation eligibility in every mode. Register untested/451 rows
 * never count, even if this process received HTTP 200. A live 451/timeout
 * excludes a source that the register currently marks reachable.
 */
export function countsTowardHealthyObservations(input: QuorumEligibilityInput): boolean {
  if (!registerDerivationGate(input, { production: false }).ok) return false;
  if (input.probe !== undefined) {
    return liveProbeGate(input.probe).ok;
  }
  return true;
}

export function remainingIndependentHealthy(
  sources: readonly QuorumEligibilityInput[],
  independenceGroups: readonly (string | undefined)[],
): number {
  const groups = new Set<string>();
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const group = independenceGroups[i];
    if (source && group && countsTowardHealthyObservations(source)) {
      groups.add(group);
    }
  }
  return groups.size;
}

export function failClosedInsufficient(
  remaining: number,
  minIndependentObservations: number,
): boolean {
  return remaining < minIndependentObservations;
}
