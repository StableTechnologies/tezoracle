# TezOracle

Configurable N-of-M Tezos Layer 1 price oracle. Generic oracle contracts, validators, coordinator, relayer, tests, and oracle docs live in this repository. TezFin consumer logic (aliases, normalization, max age, bounds, `getValidatedPrice`) stays in `StableTechnologies/TezFin`.

## Status: not production

**This repository is not a production price feed.** The authorized initial phase is **testnet and non-authoritative shadow only**. It does not authorize:

- TezFin production reliance or `set_oracle`
- production 3-of-4 cross-class quorum
- Rust Class B, or four isolated production signer environments
- production credentials, keys, or endpoints

A 1-of-1 signer configuration is permitted only for testnet and non-authoritative shadow. Pause is immediate; unpause and every risk-increasing change are delayed. USDtz and tzBTC remain non-authoritative until separately reviewed.

## What this project is

TezOracle publishes signed prices on Tezos using a **configurable N-of-M** Michelson contract. One compiled artifact supports many thresholds (including 1-of-1 for testnet/shadow and 3-of-4 as a configuration, never as hard-coded contract logic). Class A validators observe approved CEX sources, derive prices under a pinned policy, and sign a frozen payload. A non-authoritative coordinator may trigger a round and present a candidate. A permissionless relayer submits already-signed bytes and holds no keys.

The upstream view returns `(nat price, timestamp observation_time)`. Observation time is the market time used to derive the price, not Tezos inclusion time.

```text
Approved CEX sources
        |
        v
Class A (TypeScript)
        |
        v
Coordinator (candidate only; no keys)
        |
        v
Permissionless relayer (cannot mutate signed bytes)
        |
        v
N-of-M Michelson oracle
        |
        v
TezFinOracle wrapper (in TezFin)
```

This project does not depend on Acurast, Acelon, or Ubinetic.

## Quick start

Requirements: Node.js 22 (see `.nvmrc`) and Python 3.12 (see `.python-version`). Skeleton tests do not need credentials.

```bash
git clone https://github.com/StableTechnologies/TezOracle.git
cd TezOracle

npm ci
npm run typecheck
npm test
npm run validator -- derive --group CORE --fixtures tests/validator/fixtures/cex-core.json --now 1786679950
npm run coordinator -- --help
npm run relayer -- --help

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.txt
python -m pytest
python scripts/compile_oracle.py   # writes michelson/tezoracle.tz
```

`.env.example` is placeholders only. Copy it to `.env` only for later local/testnet runs. Never add production secrets.

The current tree includes the public baseline, frozen payload/register/evidence specs, TypeScript/SmartPy packing golden vectors, the N-of-M contract, Class A adapters, a non-authoritative coordinator plus permissionless relayer, a shared publication tick (`src/runtime`), local 1-of-1 e2e over mock CEX fixtures and an injected RPC, and the testnet/shadow Serverless deploy template with EventBridge `rate(5 minutes)` enabled (not production authorization). The scope gate follows. `policy_hash` and `evidence_digest` in packing vectors are recomputed from `config/` and `tests/packing/evidence/`.

## Repository layout

| Path | Role |
| --- | --- |
| `src/contract/` | SmartPy N-of-M contract, packing reference, Michelson compile |
| `michelson/` | Compiled `tezoracle.tz` (testnet artifact, not production) |
| `src/validator/` | Class A TypeScript validator |
| `src/packing/` | Canonical TypeScript PACK / digest |
| `src/coordinator/` | Non-authoritative round coordinator |
| `src/relayer/` | Permissionless submission |
| `src/runtime/` | Shared publication tick (observe → sign → submit → view) |
| `src/deploy/` | Thin Lambda handlers over coordinator, relayer, Class A, and the tick |
| `serverless.yml` | Testnet/shadow Serverless stack at repo root (`rate(5 minutes)` enabled) |
| `deploy/` | Operator checklist for a non-production `sls deploy` |
| `tests/` | Contract, validator, packing, deploy-config, runtime, and local e2e tests |
| `config/` | Versioned asset parameter register |
| `docs/` | Architecture, security, specs, engineering response |
| `.github/workflows/` | TypeScript and Python CI (no secrets) |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | N-of-M, Class A, future Class B, coordinator, relayer, TezFin boundary |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, failure modes, keys, replay, testnet limits |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Initial authorized scope vs separately approved production work |
| [docs/ENGINEERING_RESPONSE.md](docs/ENGINEERING_RESPONSE.md) | Design response to the TezFin oracle security specification |
| [docs/PAYLOAD_SPEC.md](docs/PAYLOAD_SPEC.md) | Frozen Michelson payload type, field order, PACK, domain `TEZORACLE_V1` |
| [docs/EVIDENCE_SPEC.md](docs/EVIDENCE_SPEC.md) | Quorum-shared digest vs signer-local evidence; fail-closed mismatch |
| [docs/OBSERVER_AGREEMENT.md](docs/OBSERVER_AGREEMENT.md) | Windows, median, rounding, rounds, candidate verification |
| [docs/PARAMETER_SCHEMA.md](docs/PARAMETER_SCHEMA.md) | Register schema, lifecycle, delayed activation |
| [docs/CONTRACT_SPEC.md](docs/CONTRACT_SPEC.md) | N-of-M storage, submit, pause, delayed governance, views |
| [docs/ORACLE_INTERFACE.md](docs/ORACLE_INTERFACE.md) | TezFin boundary: price + observation time; aliases/age/bounds stay in TezFin |
| [docs/TESTNET_DEPLOY.md](docs/TESTNET_DEPLOY.md) | Shadownet/sandbox origination without production keys |
| [docs/CLASS_A_VALIDATOR.md](docs/CLASS_A_VALIDATOR.md) | Class A adapters, derivation, candidate verify, testnet signing |
| [docs/COORDINATOR.md](docs/COORDINATOR.md) | Non-authoritative round trigger, candidate, signature collection |
| [docs/RELAYER.md](docs/RELAYER.md) | Permissionless verify / simulate / broadcast; backup path |
| [docs/AWS_DEPLOY.md](docs/AWS_DEPLOY.md) | Non-production Lambda/EventBridge template; IAM split; testnet 5-minute tick |
| [tests/packing/README.md](tests/packing/README.md) | Frozen PACK vectors and test-only signatures |

## License

Apache License 2.0. See [LICENSE](LICENSE).
