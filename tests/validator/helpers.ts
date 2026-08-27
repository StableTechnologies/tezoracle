import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMockTransport, loadFixtureMap, type HttpTransport, type MockFixture } from "../../src/validator/adapters/http.js";
import { pinSnapshot } from "../../src/validator/policy.js";

export const NOW = 1786679950;
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_DIR = join(ROOT, "config");
export const FIXTURES_PATH = join(ROOT, "tests/validator/fixtures/cex-core.json");

export function pinnedRegister() {
  return pinSnapshot(CONFIG_DIR);
}

export function coreMockTransport(): HttpTransport {
  const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as unknown;
  return createMockTransport(loadFixtureMap(raw));
}

export function coreMockTransportWithoutHost(host: string): HttpTransport {
  const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Record<string, MockFixture>;
  const fixtures: Record<string, MockFixture> = {};
  for (const [url, fixture] of Object.entries(raw)) {
    fixtures[url] = url.includes(host) ? { body: {}, error: "TIMEOUT" } : fixture;
  }
  return createMockTransport(fixtures);
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
