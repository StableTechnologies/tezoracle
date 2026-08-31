# Deploy (non-production)

Template for one **testnet/shadow** Serverless stack. Not four accounts. Not production.

The stack file is [`serverless.yml`](../serverless.yml) at the **repository root**. Serverless Framework v3 uses that directory as `serviceDir`, so `src/deploy/*` handlers and `config/**` resolve. Do not move the file under `deploy/` and do not pass `--config deploy/serverless.yml`.

Full policy: [docs/AWS_DEPLOY.md](../docs/AWS_DEPLOY.md).

## Never commit

- `.env`, Secrets Manager values, `edsk` strings, AWS access keys
- `.serverless/`, `.esbuild/`, `*.zip`
- A concrete AWS account ID
- An enabled EventBridge rule treated as production authorization

CI validates `serverless.yml` and runs `serverless package` (no AWS account). Do not add AWS credentials to GitHub Actions. Never run `sls deploy` in CI.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- A non-production AWS account and a profile that can create IAM, Lambda, EventBridge, and Secrets Manager resources in that account
- Testnet placeholders: `TEZOS_RPC_URL`, `TEZOS_CHAIN_ID`, `ORACLE_ADDRESS` (Ghostnet)
- A **testnet-only** Class A `edsk` that you will paste into Secrets Manager in the console

Pinned operator tools are already in `devDependencies`: `serverless@3.40.0` and `serverless-esbuild@1.57.2`. Do not `npm install serverless` unpinned — that pulls Framework 4, which rejects `frameworkVersion: "3"`.

```bash
npm ci
```

## Deploy

From the repository root:

```bash
export TEZOS_RPC_URL="https://your-ghostnet-rpc.example"
export TEZOS_CHAIN_ID="NetXnHfVqm9iesp"
export ORACLE_ADDRESS="KT1..."   # testnet oracle, never a TezFin production pointer

npx serverless deploy --stage testnet --region us-east-1
```

Framework 3.40 may warn that `nodejs22.x` is not in its local schema. AWS accepts that runtime; the warning is not a packaging failure.

Then, in the AWS console for that account, set the secret value on `tezoracle/testnet/class-a-signer`. Do not put `TEZORACLE_SIGNER_SECRET_KEY` on the coordinator or relayer functions.

The optional relayer fee-payer secret `tezoracle/testnet/relayer-fee-payer` is not an oracle signer. Leave it empty until a later injector exists.

## After deploy

This stack is testnet/shadow transport. EventBridge `rate(5 minutes)` is enabled on `coordinatorTick`. That is not production authorization.

1. Confirm EventBridge rule `tezoracle-testnet-tick` is the testnet/shadow tick, not a production cadence.
2. Confirm the coordinator (including `coordinatorTick`) and relayer roles cannot `GetSecretValue` on the Class A signer secret.
3. You may invoke coordinator/relayer directly to inspect wiring. Do not publish a public signer API.
4. `signerClassA` has the secret **name** only. A live invoke will not sign until a Secrets Manager fetch is injected (later work). The tick must invoke Class A; it must not read the signer secret.
5. `relayerSubmit` is not a live Ghostnet injector in this repository. Local e2e uses an injected mock / harness RPC.
6. `relayerBackup` is a second function on the same sealed batch as `relayerSubmit`.
7. Do not point TezFin `set_oracle` at the originated testnet contract.

Remove the stack from the same non-production account when finished:

```bash
npx serverless remove --stage testnet --region us-east-1
```
