/**
 * Probe registered HTTPS endpoints from this process's network path.
 *
 * This is an operator tool, not a CI gate: some regions receive HTTP 451
 * from api.binance.com. An untested or 451 endpoint must not be counted as
 * a healthy production source.
 *
 * Usage: npx tsx scripts/probe-source-endpoints.ts
 */
import { loadCommittedRegister } from "../src/config/policy.js";
import { classifyProbe, type ProbeOutcome } from "../src/sources/health.js";

const timeoutMs = 5000;

async function probe(url: string): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal, redirect: "error" });
    return { kind: "http", status: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { kind: "timeout" };
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

const { snapshot } = loadCommittedRegister();
console.log("signer_environments", JSON.stringify(snapshot.register.signer_environments, null, 2));
console.log("probe_note: results from this host are not a production health attestation");

for (const [assetId, asset] of Object.entries(snapshot.assets)) {
  for (const source of asset.sources) {
    const url = source.query ? `${source.endpoint}?${source.query}` : source.endpoint;
    const outcome = await probe(url);
    const classified = classifyProbe(outcome);
    const healthy = classified === "ok";
    console.log(
      JSON.stringify({
        asset_id: assetId,
        source_id: source.source_id,
        url,
        outcome,
        classified,
        counts_as_healthy: healthy,
        register_probe_status: source.health.probe_status,
        eligible_for_production_quorum: source.health.eligible_for_production_quorum,
      }),
    );
  }
}
