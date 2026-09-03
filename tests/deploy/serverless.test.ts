import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PLACEHOLDER_ENV, SIGNER_SECRET_ENV } from "../../src/deploy/env.js";
import { asList, asMap, parseYaml, type YamlValue } from "./parse-yml.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const YML_PATH = join(ROOT, "serverless.yml");
const SOURCE = readFileSync(YML_PATH, "utf8");
const DOC = asMap(parseYaml(SOURCE), "serverless.yml");

const COORDINATOR_FUNCTIONS = [
  "coordinatorTick",
  "coordinatorTrigger",
  "coordinatorCandidate",
  "coordinatorCollect",
  "coordinatorAssemble",
] as const;
const RELAYER_FUNCTIONS = ["relayerVerify", "relayerSubmit", "relayerBackup"] as const;
const SIGNER_FUNCTIONS = ["signerClassA", "signerGovernance"] as const;

function functions(): { [name: string]: { [key: string]: YamlValue } } {
  const raw = asMap(DOC.functions, "functions");
  const out: { [name: string]: { [key: string]: YamlValue } } = {};
  for (const [name, value] of Object.entries(raw)) {
    out[name] = asMap(value, `functions.${name}`);
  }
  return out;
}

function mergedEnv(fn: { [key: string]: YamlValue }): Record<string, string> {
  const provider = asMap(DOC.provider, "provider");
  const providerEnv = asMap(provider.environment ?? {}, "provider.environment");
  const fnEnv = asMap(fn.environment ?? {}, `function.environment`);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...providerEnv, ...fnEnv })) {
    out[key] = value === null || value === undefined ? "" : String(value);
  }
  return out;
}

function walk(value: YamlValue, visit: (node: YamlValue) => void): void {
  visit(value);
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) walk(child, visit);
  }
}

function resources(): { [name: string]: { [key: string]: YamlValue } } {
  const raw = asMap(asMap(DOC.resources, "resources").Resources, "resources.Resources");
  const out: { [name: string]: { [key: string]: YamlValue } } = {};
  for (const [name, value] of Object.entries(raw)) {
    out[name] = asMap(value, `Resources.${name}`);
  }
  return out;
}

function roleStatements(roleName: string): { [key: string]: YamlValue }[] {
  const role = resources()[roleName];
  assert.ok(role, roleName);
  const properties = asMap(role.Properties, `${roleName}.Properties`);
  const policies = asList(properties.Policies, `${roleName}.Policies`);
  const statements: { [key: string]: YamlValue }[] = [];
  for (const policy of policies) {
    const doc = asMap(asMap(policy, "policy").PolicyDocument, "PolicyDocument");
    for (const statement of asList(doc.Statement, "Statement")) {
      statements.push(asMap(statement, "Statement"));
    }
  }
  return statements;
}

function flattenActions(value: YamlValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

function flattenResources(value: YamlValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

test("serverless.yml lives at the repository root with resolvable handlers and config", () => {
  assert.equal(YML_PATH, join(ROOT, "serverless.yml"));
  assert.equal(existsSync(join(ROOT, "deploy", "serverless.yml")), false);
  assert.ok(existsSync(join(ROOT, "config", "register.json")));
  const fns = functions();
  for (const fn of Object.values(fns)) {
    const handler = String(fn.handler);
    const source = join(ROOT, `${handler.replace(/\.[^./]+$/, "")}.ts`);
    assert.equal(existsSync(source), true, source);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
  };
  assert.match(pkg.devDependencies.serverless ?? "", /^3\./);
  assert.match(pkg.devDependencies["serverless-esbuild"] ?? "", /^1\./);
  assert.equal(DOC.frameworkVersion, "3");
});

test("serverless.yml is one testnet/shadow stack on Node 22", () => {
  assert.equal(DOC.service, "tezoracle-testnet-shadow");
  const provider = asMap(DOC.provider, "provider");
  assert.equal(provider.name, "aws");
  assert.equal(provider.runtime, "nodejs22.x");
  assert.equal(String(provider.stage), '${opt:stage, "testnet"}');
  const env = asMap(provider.environment, "provider.environment");
  assert.equal(env.TEZOS_NETWORK, "shadownet");
  for (const name of PLACEHOLDER_ENV) {
    assert.ok(name in env, `provider.environment.${name}`);
  }
  assert.equal(env.TEZORACLE_SIGNER_SECRET_KEY, undefined);
});

test("required transport functions exist and signer has no public events", () => {
  const fns = functions();
  for (const name of [...COORDINATOR_FUNCTIONS, ...RELAYER_FUNCTIONS, ...SIGNER_FUNCTIONS]) {
    assert.ok(fns[name], name);
  }
  assert.match(String(fns.coordinatorTick?.handler), /src\/deploy\/tick\.tick/);
  assert.match(String(fns.coordinatorTrigger?.handler), /src\/deploy\/coordinator\.trigger/);
  assert.match(String(fns.coordinatorCandidate?.handler), /src\/deploy\/coordinator\.candidate/);
  assert.match(String(fns.coordinatorCollect?.handler), /src\/deploy\/coordinator\.collect/);
  assert.match(String(fns.coordinatorAssemble?.handler), /src\/deploy\/coordinator\.assemble/);
  assert.match(String(fns.relayerVerify?.handler), /src\/deploy\/relayer\.verify/);
  assert.match(String(fns.relayerSubmit?.handler), /src\/deploy\/relayer\.submit/);
  assert.equal(fns.relayerBackup?.handler, fns.relayerSubmit?.handler);
  assert.match(String(fns.signerClassA?.handler), /src\/deploy\/signer\.sign/);
  assert.equal(fns.signerClassA?.events, undefined);
  assert.match(String(fns.signerGovernance?.handler), /src\/deploy\/signer\.signGovernance/);
  assert.equal(fns.signerGovernance?.events, undefined);
});

test("coordinator and relayer env never include the oracle signer secret", () => {
  const fns = functions();
  for (const name of [...COORDINATOR_FUNCTIONS, ...RELAYER_FUNCTIONS]) {
    const env = mergedEnv(fns[name] ?? {});
    assert.equal(env[SIGNER_SECRET_ENV], undefined, name);
    assert.equal(env.TEZORACLE_SIGNER_SECRET_NAME, undefined, name);
  }
  for (const name of SIGNER_FUNCTIONS) {
    const signerEnv = mergedEnv(fns[name] ?? {});
    assert.equal(signerEnv[SIGNER_SECRET_ENV], undefined);
    assert.match(signerEnv.TEZORACLE_SIGNER_SECRET_NAME ?? "", /\$\{self:custom\.signerSecretName\}/);
  }
  const governanceEnv = mergedEnv(fns.signerGovernance ?? {});
  assert.equal(governanceEnv.TEZORACLE_GOVERNANCE_INTENT_PATH, undefined);
  assert.equal(governanceEnv.TEZORACLE_GOVERNANCE_SIDECAR, undefined);
  assert.equal(governanceEnv.TEZORACLE_GOVERNANCE_INTENT_SHA256, undefined);
  assert.equal(governanceEnv.TEZORACLE_GOVERNANCE_SIDECAR_SHA256, undefined);
  const custom = asMap(DOC.custom, "custom");
  assert.equal(custom.governanceManifest, undefined);
});

test("EventBridge schedule is enabled on the coordinator tick at rate(5 minutes)", () => {
  const tick = functions().coordinatorTick;
  assert.ok(tick);
  const events = asList(tick.events, "coordinatorTick.events");
  assert.equal(events.length, 1);
  const schedule = asMap(asMap(events[0], "event").schedule, "schedule");
  assert.equal(schedule.rate, "rate(5 minutes)");
  assert.equal(schedule.enabled, true);
  assert.equal(functions().coordinatorTrigger?.events, undefined);
});

test("IAM denies coordinator and relayer GetSecretValue on the signer secret", () => {
  const custom = asMap(DOC.custom, "custom");
  assert.equal(custom.signerSecretName, "tezoracle/testnet/class-a-signer");
  assert.equal(custom.feePayerSecretName, "tezoracle/testnet/relayer-fee-payer");

  const coordinatorDeny = roleStatements("CoordinatorLambdaRole").filter(
    (statement) => statement.Sid === "DenyOracleSignerSecret",
  );
  assert.equal(coordinatorDeny.length, 1);
  assert.equal(coordinatorDeny[0]?.Effect, "Deny");
  assert.ok(flattenActions(coordinatorDeny[0]?.Action).includes("secretsmanager:GetSecretValue"));
  assert.ok(
    flattenResources(coordinatorDeny[0]?.Resource).some((arn) => arn.includes("${self:custom.signerSecretName}")),
  );

  const relayerStatements = roleStatements("RelayerLambdaRole");
  const relayerDeny = relayerStatements.find((statement) => statement.Sid === "DenyOracleSignerSecret");
  const relayerAllowFee = relayerStatements.find((statement) => statement.Sid === "AllowFeePayerSecret");
  assert.ok(relayerDeny);
  assert.equal(relayerDeny.Effect, "Deny");
  assert.ok(flattenResources(relayerDeny.Resource).some((arn) => arn.includes("${self:custom.signerSecretName}")));
  assert.ok(relayerAllowFee);
  assert.equal(relayerAllowFee.Effect, "Allow");
  assert.ok(flattenResources(relayerAllowFee.Resource).some((arn) => arn.includes("${self:custom.feePayerSecretName}")));

  const signerAllow = roleStatements("SignerLambdaRole").find((statement) => statement.Sid === "AllowOracleSignerSecret");
  assert.ok(signerAllow);
  assert.equal(signerAllow.Effect, "Allow");
  assert.ok(flattenActions(signerAllow.Action).includes("secretsmanager:GetSecretValue"));
  assert.ok(flattenResources(signerAllow.Resource).some((arn) => arn.includes("${self:custom.signerSecretName}")));
});

test("coordinator cannot invoke the governance signer", () => {
  const invoke = roleStatements("CoordinatorLambdaRole").find(
    (statement) => statement.Sid === "InvokeClassASigner",
  );
  assert.ok(invoke);
  const allowed = flattenResources(invoke.Resource);
  assert.ok(allowed.some((arn) => arn.endsWith("-signerClassA")));
  assert.ok(allowed.every((arn) => !arn.includes("signerGovernance")));
});

test("template has no committed secrets, account IDs, or production cadence", () => {
  assert.doesNotMatch(SOURCE, /edsk[1-9A-HJ-NP-Za-km-z]{20,}/);
  assert.doesNotMatch(SOURCE, /TEZORACLE_SIGNER_SECRET_KEY\s*:/);
  assert.doesNotMatch(SOURCE, /AKIA[0-9A-Z]{16}/);
  assert.doesNotMatch(SOURCE, /aws_secret_access_key/i);
  const accountIds: string[] = [];
  for (const match of SOURCE.matchAll(/(?<!\$\{AWS::AccountId})(?<![A-Za-z])\d{12}(?![A-Za-z0-9])/g)) {
    if (match[0] && !match[0].startsWith("2012")) accountIds.push(match[0]);
  }
  assert.deepEqual(accountIds, []);
  assert.match(SOURCE, /enabled:\s*true/);
  assert.match(SOURCE, /Not production authorization/);
});

test("roles are split and backup relayer reuses submit", () => {
  const fns = functions();
  for (const name of COORDINATOR_FUNCTIONS) {
    assert.equal(fns[name]?.role, "CoordinatorLambdaRole");
  }
  for (const name of RELAYER_FUNCTIONS) {
    assert.equal(fns[name]?.role, "RelayerLambdaRole");
  }
  for (const name of SIGNER_FUNCTIONS) {
    assert.equal(fns[name]?.role, "SignerLambdaRole");
  }
  const placeholders = resources();
  assert.equal(placeholders.SignerSecretPlaceholder?.Type, "AWS::SecretsManager::Secret");
  assert.equal(placeholders.FeePayerSecretPlaceholder?.Type, "AWS::SecretsManager::Secret");
});

test("USDTZ and TZBTC each get their own 5-minute scheduled tick, isolated by reserved concurrency", () => {
  const fns = functions();
  for (const [name, group] of [
    ["coordinatorTick", "CORE"],
    ["coordinatorTickUsdtz", "USDTZ"],
    ["coordinatorTickTzbtc", "TZBTC"],
  ] as const) {
    const fn = fns[name];
    assert.ok(fn, name);
    assert.equal(fn.role, "CoordinatorLambdaRole", name);
    assert.equal(fn.reservedConcurrency, 1, name);
    assert.equal(fn.timeout, 180, name);
    assert.equal(fn.memorySize, 512, name);
    const events = asList(fn.events, `${name}.events`);
    assert.equal(events.length, 1, name);
    const schedule = asMap(asMap(events[0], "event").schedule, "schedule");
    assert.equal(schedule.rate, "rate(5 minutes)", name);
    assert.equal(schedule.enabled, true, name);
    const input = asMap(schedule.input, `${name}.schedule.input`);
    assert.equal(input.group, group, name);
  }
});

test("recommended AWS infra topology is applied (region, arch, no VPC, log retention)", () => {
  const provider = asMap(DOC.provider, "provider");
  assert.equal(String(provider.region), '${opt:region, "eu-central-1"}');
  assert.equal(provider.architecture, "arm64");
  assert.equal(provider.logRetentionInDays, 60);
  assert.equal(provider.vpc, undefined);
});

test("DynamoDB tables exist for TWAP samples and round state with correct IAM scoping", () => {
  const res = resources();
  const poolSamples = res.PoolSamplesTable;
  assert.equal(poolSamples?.Type, "AWS::DynamoDB::Table");
  const poolSamplesProps = asMap(poolSamples?.Properties, "PoolSamplesTable.Properties");
  assert.equal(poolSamplesProps.BillingMode, "PAY_PER_REQUEST");
  const poolSamplesTtl = asMap(poolSamplesProps.TimeToLiveSpecification, "PoolSamplesTable.TimeToLiveSpecification");
  assert.equal(poolSamplesTtl.Enabled, true);

  const roundState = res.RoundStateTable;
  assert.equal(roundState?.Type, "AWS::DynamoDB::Table");
  const roundStateProps = asMap(roundState?.Properties, "RoundStateTable.Properties");
  assert.equal(roundStateProps.BillingMode, "PAY_PER_REQUEST");
  // No TTL on round state -- it is replay-protection, not a cache.
  assert.equal(roundStateProps.TimeToLiveSpecification, undefined);

  const coordinatorPoolSamples = roleStatements("CoordinatorLambdaRole").find(
    (statement) => statement.Sid === "AllowPoolSamplesTable",
  );
  assert.ok(coordinatorPoolSamples);
  assert.ok(flattenActions(coordinatorPoolSamples.Action).includes("dynamodb:PutItem"));

  const signerStateTables = roleStatements("SignerLambdaRole").find(
    (statement) => statement.Sid === "AllowStateTables",
  );
  assert.ok(signerStateTables);
  assert.equal(flattenActions(signerStateTables.Action).length, 2);
});

test("parsed document does not embed secret-shaped strings", () => {
  walk(DOC, (node) => {
    if (typeof node === "string") {
      assert.doesNotMatch(node, /^edsk[1-9A-HJ-NP-Za-km-z]+$/);
      assert.notEqual(node, "TEZORACLE_SIGNER_SECRET_KEY");
    }
    if (typeof node === "object" && node !== null && !Array.isArray(node)) {
      assert.ok(!("TEZORACLE_SIGNER_SECRET_KEY" in node));
    }
  });
});
