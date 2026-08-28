# Architecture

TezOracle is a generic Tezos Layer 1 price oracle. This repository owns the Michelson contract, off-chain validators, coordinator, relayer, tests, and oracle documentation. TezFin-specific consumer behavior stays in `StableTechnologies/TezFin`.

**Current authorization:** testnet and non-authoritative shadow. This document describes the intended architecture, including production-phase components that are **not** being built in the initial phase.

## Design constraints

- Configurable **N-of-M from the start**. Never a disposable `SimplePriceOracle`. Never hard-code 3-of-4. 1-of-1 is testnet/shadow only.
- Coordinator is non-authoritative; relayer is permissionless and holds no signing keys.
- Pause is immediate; unpause and all risk-increasing changes are delayed.
- Upstream view returns `(nat price, timestamp observation_time)`. Do not duplicate TezFin `configureMaxPriceAge` or `configurePriceBounds`.
- No Acurast, Acelon, or Ubinetic.
- No production credentials, keys, or endpoints in this repository.
- USDtz and tzBTC stay non-authoritative until separately reviewed.

## Data path (initial phase)

```text
Approved CEX sources
        |
        v
Class A TypeScript validator
  observe -> derive under pinned policy -> verify candidate -> sign frozen payload
        |
        v
Coordinator (optional candidate; no keys; does not choose price or policy)
        |
        v
Permissionless relayer (local verify, simulate, broadcast; cannot mutate signed bytes)
        |
        v
N-of-M Michelson oracle
        |
        v
TezFinOracle wrapper (TezFin repo)
        |
        v
Comptroller consumer safeguards (TezFin repo)
```

Anyone may submit a valid signed batch. A backup relayer can relay the same bytes without access to signing keys.

## On-chain: configurable N-of-M contract

One SmartPy contract, compiled to Michelson, is parameterized by:

| Parameter | Meaning |
| --- | --- |
| `M` | Active signer set size |
| `N` | Signature threshold |
| Class minima | Minimum signatures required from each validator class (`0` allowed for 1-of-1) |
| Signer set | Index, public key, and class per signer |

The contract:

- Accepts permissionless `submit`.
- Verifies `CHECK_SIGNATURE` over frozen `PACK(payload)`.
- Rejects unknown, duplicate, and inactive signers.
- Domain-separates with `chain_id` and the oracle contract address.
- Enforces a monotonic per-publication-group round.
- Rejects stale and future observation times per policy.
- Distinguishes pending vs active price with a non-zero activation delay.
- Exposes a public view of only the mature `(nat, timestamp)` using **observation** time, not inclusion time.
- Pauses immediately; resumes and governance (signer set, N/M, class minima, policy hash, assets) activate only after delay.

Publication groups (`CORE`, `USDTZ`, `TZBTC`) isolate asset families so a USDtz or tzBTC failure does not block a healthy core update.

## Off-chain: Class A (this phase)

Class A is a TypeScript validator. It:

- Reads approved CEX adapters (initial phase: two named venues, with remaining adapters as stretch).
- Derives price, oldest contributing observation time, and evidence from the versioned parameter register.
- Independently verifies any coordinator candidate under the pinned policy and **does not sign on mismatch**.
- Signs only the frozen canonical payload, using testnet keys from runtime configuration.

Policy (sources, min observations, deviation, aggregation, rounding, decimals) is never taken from a request, coordinator, or relayer.

## Off-chain: Class B (not this phase)

Production independence requires a second validation class that does not reuse Class A's acceptance function, policy parser, or compiled artifact. The proposed Class B language is Rust. Class B, four isolated signer environments (A1, A2, B1, B2), and production 3-of-4 with class minima are **separately authorized** work. See [ROADMAP.md](ROADMAP.md).

## Coordinator

The coordinator may trigger a round and may assemble a candidate payload for validators to consider. It:

- Holds **no** signing keys.
- Does **not** choose the authoritative price.
- Does **not** supply or override policy (sources, tolerance, decimals, aggregation, freshness).

Validators independently derive or verify under the pinned, version-controlled policy.

## Relayer

The relayer is permissionless:

- Verifies signatures locally.
- Simulates the contract call.
- Broadcasts accepted operations.
- Must not modify signed payload bytes.
- Holds no signing keys.

A backup relayer must be able to submit the same signed batch if the primary path is down.

## TezFin boundary

| Lives in TezOracle | Lives in TezFin |
| --- | --- |
| N-of-M contract, signer set, rounds, pause/governance | Aliases and symbol compatibility |
| Frozen payload, evidence, observer agreement | Normalization |
| Class A (and later Class B) validation | `configureMaxPriceAge`, `configurePriceBounds` |
| Coordinator and relayer | `getValidatedPrice` and Comptroller checks |
| View: `(nat price, timestamp observation_time)` | Consumer freshness, bounds, and market policy |

This repository must not add TezFin-specific wrapper or Comptroller code.

## Payload (frozen)

Logical fields, in specification order:

`domain`, `chain_id`, `oracle_address`, `config_version`, `policy_hash`, `publication_group`, `round`, `valid_from`, `valid_until`, `evidence_digest`, ordered asset list (`asset_id`, `price`, `decimals`, `observation_time`).

Domain: `TEZORACLE_V1`. Exact Michelson type, rejection rules, and PACK rules: [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md). Evidence digest: [EVIDENCE_SPEC.md](EVIDENCE_SPEC.md). Derivation and candidate checks: [OBSERVER_AGREEMENT.md](OBSERVER_AGREEMENT.md). Asset policy: [PARAMETER_SCHEMA.md](PARAMETER_SCHEMA.md) and `config/`.

Signatures cover `PACK(payload)` exactly. Packing implementations must not silently reorder or normalize fields. Frozen hex, Micheline, and BLAKE2B live in `tests/packing/vectors/`; TypeScript and SmartPy must match them byte-for-byte. Rust Class B is later work against the same vectors.

## Repository map

```text
src/contract/      SmartPy N-of-M contract
src/validator/     Class A TypeScript
src/packing/       Canonical PACK / digest
src/coordinator/   Non-authoritative coordinator
src/relayer/       Permissionless relayer
tests/             Unit, contract, packing, e2e
config/            Versioned parameter register
docs/              Specs and design record
```
