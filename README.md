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

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest
```

`.env.example` is placeholders only. Copy it to `.env` only for later local/testnet runs. Never add production secrets.

The current tree is a public baseline: layout, docs, and CI skeleton. Payload freeze, packing parity, the N-of-M contract, Class A adapters, coordinator/relayer, and local e2e follow in later PRs. Signing is blocked until packing golden vectors pass.

## Repository layout

| Path | Role |
| --- | --- |
| `src/contract/` | SmartPy N-of-M contract |
| `src/validator/` | Class A TypeScript validator |
| `src/packing/` | Canonical payload packing |
| `src/coordinator/` | Non-authoritative round coordinator |
| `src/relayer/` | Permissionless submission |
| `tests/` | Contract, validator, packing, and later e2e tests |
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

Payload, evidence, observer-agreement, parameter-schema, contract, Class A, coordinator, relayer, and oracle-interface specs are added when those workstreams start. Until then, treat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) as the controlling overview.

## License

Apache License 2.0. See [LICENSE](LICENSE).
