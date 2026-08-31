# AWS / Serverless deploy (testnet and shadow only)

**Status:** deploy template. Not a live publication loop.  
**Authority:** one non-production account. 1-of-1 Class A only.  
**Keys:** the oracle signer secret is never in git, CI, or coordinator/relayer IAM or environment.

This is transport configuration for the existing coordinator, relayer, and Class A modules. It does not invent a second price path and does not authorize production, four isolated signer accounts, or TezFin `set_oracle`.

Topology matches [ENGINEERING_RESPONSE.md](ENGINEERING_RESPONSE.md) §3.6: Lambda + EventBridge is acceptable; a shared coordinator/relayer must not hold signing keys or become a policy authority.

## 1. What is in the repository

| Path | Role |
| --- | --- |
| [serverless.yml](../serverless.yml) | One `tezoracle-testnet-shadow` stack at the repository root |
| [src/deploy/](../src/deploy/) | Thin handlers over `src/coordinator`, `src/relayer`, `src/validator` |
| [deploy/README.md](../deploy/README.md) | Operator checklist for `sls deploy` |

The stack file is at the repo root so Framework v3 `serviceDir` resolves `src/deploy/*` and `config/**`. CI parses the template and runs `serverless package`. CI never runs `sls deploy` and never receives AWS credentials.

## 2. Functions

| Function | Handler | Role | May read oracle signer secret |
| --- | --- | --- | --- |
| `coordinatorTrigger` | `src/deploy/coordinator.trigger` | Round request from the pinned register | No |
| `coordinatorCandidate` | `src/deploy/coordinator.candidate` | Derive a candidate under the same register | No |
| `coordinatorCollect` | `src/deploy/coordinator.collect` | Collect a signature over frozen `PACK(payload)` | No |
| `coordinatorAssemble` | `src/deploy/coordinator.assemble` | Seal a portable signed batch | No |
| `relayerVerify` | `src/deploy/relayer.verify` | Local `CHECK_SIGNATURE` / quorum | No |
| `relayerSubmit` | `src/deploy/relayer.submit` | Simulate / broadcast via an injected RPC | No |
| `relayerBackup` | same submit handler | Second function on the **same** sealed batch | No |
| `signerClassA` | `src/deploy/signer.sign` | Verify locally, then sign. Internal invoke only | Yes |

There is no public signer HTTP API. 1-of-1 testnet may call Class A in-process (same tick, later work) or `lambda:InvokeFunction` from the coordinator role. Coordinator and relayer processes still hold no keys.

`relayerSubmit` is not a live Ghostnet injector in this repository. Live RPC adapters stay with local e2e. A fee-paying Tezos account, if added later, is a **fee-payer** secret and must not appear in the oracle signer set.

## 3. Environment placeholders

Same names as [.env.example](../.env.example):

| Name | Template default |
| --- | --- |
| `TEZOS_NETWORK` | `ghostnet` |
| `TEZOS_RPC_URL` | empty placeholder |
| `TEZOS_CHAIN_ID` | empty placeholder |
| `ORACLE_ADDRESS` | empty placeholder |

Name-only Secrets Manager placeholders (values are set in the AWS console, never committed):

| Name | Secret | Who may `GetSecretValue` |
| --- | --- | --- |
| `TEZORACLE_SIGNER_SECRET_NAME` | `tezoracle/testnet/class-a-signer` | `signerClassA` only |
| `TEZORACLE_FEE_PAYER_SECRET_NAME` | `tezoracle/testnet/relayer-fee-payer` | relayer functions only |

`TEZORACLE_SIGNER_SECRET_KEY` must not appear in coordinator or relayer environment. The template does not set it on any function.

## 4. IAM split

- Coordinator role: logs, optional invoke of `signerClassA`, **Deny** `GetSecretValue` on the Class A signer secret.
- Relayer role: logs, **Allow** `GetSecretValue` on the fee-payer secret, **Deny** `GetSecretValue` on the Class A signer secret.
- Signer role: logs, **Allow** `GetSecretValue` on the Class A signer secret.

CloudFormation uses `${AWS::AccountId}`. This repository must not contain a concrete AWS account ID.

## 5. EventBridge cadence

`coordinatorTrigger` declares:

```text
rate: rate(5 minutes)
enabled: false
```

The 5-minute publication tick is later work. Do not enable this rule to create a production cadence. `validity_window_seconds` remains 180; that is the submit window, not permission to run a live loop from this template.

## 6. How to deploy to a non-production account

See [deploy/README.md](../deploy/README.md). Requirements:

- A **non-production** AWS account you control
- Testnet-only Tezos values for the placeholders
- The Class A `edsk` entered into Secrets Manager in that account, never into git
- Pinned `serverless@3.40.0` and `serverless-esbuild@1.57.2` from `npm ci` (do not install unpinned Serverless 4)

Never deploy this stack with production keys, a production signer set, or TezFin `set_oracle` pointed at the result.

## 7. What must never be committed

- `.env`, Secrets Manager values, `edsk` material, AWS access keys
- `.serverless/`, `.esbuild/`, packaged `.zip` artifacts
- Production account IDs, production RPC URLs, or an enabled 5-minute rule intended as production authorization

## 8. Out of scope

- Four isolated signer environments (A1, A2, B1, B2)
- Production 3-of-4 and Rust Class B
- Enabling EventBridge as a live publication loop
- TezFin `set_oracle`
- AWS credentials or `sls deploy` in CI
