# Security

This document is the public security overview for the **testnet and non-authoritative shadow** phase. It does not replace `TEZFIN_ORACLE_SECURITY_SPECIFICATION_2026_08_11.md` as the production baseline, and it does not grant production approval.

## Status

TezOracle is not a production authority. A 1-of-1 configuration, a passing testnet, and a shadow publication are not TezFin borrow, collateral, liquidation, or other price-dependent risk authority.

Until Class B and four isolated signer environments exist, the system does not meet the production independence model. Treat every price from this phase as non-authoritative.

## Security objectives

| Property | Requirement |
| --- | --- |
| Integrity | A requester, coordinator, relayer, RPC, or a single signing key must not be able to force an arbitrary accepted price under the intended production quorum. In 1-of-1 testnet/shadow, that property does not hold — which is why 1-of-1 is forbidden for production. |
| Availability | Loss of one relayer, RPC, or approved CEX source should not block a healthy core update. Availability is never obtained by weakening validation. |
| Freshness | The timestamp exposed downstream is the market observation time used to derive the price. Republishing an old value in a new Tezos operation must not make it fresh. |
| Isolation | USDtz or tzBTC failure must not automatically block XTZ, BTC, or USDt. Those two assets stay non-authoritative until separately reviewed. |
| Auditability | Accepted batches are reproducible from a versioned policy and attributable to a defined signer set. Evidence is retained; secrets are not. |

## Trust boundaries

```text
Untrusted
  requester, coordinator, relayer, RPC, CEX HTTP, backup relayer

Trusted only insofar as policy and quorum require
  pinned parameter register
  Class A derivation / verification (this phase)
  N-of-M CHECK_SIGNATURE over frozen PACK(payload)
  delayed governance; immediate pause

Out of scope this phase
  Class B independent implementation
  A1/A2/B1/B2 operational isolation
  production 3-of-4 with class minima
```

The coordinator and relayer are **untrusted for price and policy**. They may transport bytes. They may not select sources, deviation, min observations, aggregation, decimals, freshness, or the authoritative price. Validators never accept request-supplied policy.

## Threat model (initial phase)

| Threat | Mitigation in this phase |
| --- | --- |
| Coordinator supplies a false price | Validators independently derive or verify under pinned policy; mismatch is fail-closed; no signature. |
| Relayer mutates signed bytes | Relayer must not modify payload; contract verifies `CHECK_SIGNATURE` over exact `PACK(payload)`. |
| Replay on another chain or contract | Payload binds `domain`, `chain_id`, and `oracle_address`. |
| Replay of an old round | Per-group round is strictly monotonic. |
| Stale or future market time | Observation timestamps are checked; inclusion time is not used as freshness. |
| Duplicate or unknown signer | Contract rejects unknown, inactive, and duplicate signer indices. |
| Insufficient quorum | Configurable `N` of `M`; 1-of-1 is testnet/shadow only. |
| Governance foot-gun | Pause is immediate. Unpause, signer-set changes, N/M, class minima, policy hash, and asset changes are delayed. |
| Secrets in git or CI | `.gitignore` excludes key material; `.env.example` is placeholders; CI has no secrets. |
| Silent packing drift | TypeScript and SmartPy packing tests must match frozen golden vectors byte-for-byte. |

## Failure modes

The system **fails closed**. If observations are missing, sources disagree beyond policy, evidence mismatches, packing is wrong, the candidate does not match local derivation, quorum is incomplete, or the contract is paused, the update is refused. There is no coordinator override, no degraded “publish anyway” path, and no one-pool USDtz degraded mode in this phase.

USDtz and tzBTC publication groups may fail independently of `CORE`. They are not consumed as authoritative feeds in this phase.

## Key handling

- No production credentials, keys, or endpoints are stored in this repository.
- Testnet signer secrets come from runtime configuration (`.env`, never committed).
- Coordinator and relayer processes hold no signing keys.
- Test-only keys and signatures used for golden vectors are stored separately from any production secret and are not production material.
- Compromising a 1-of-1 testnet key is a full compromise of that deployment. That is an accepted testnet limitation, not a production design.

## Replay and domain separation

Every signed payload includes:

- a domain tag (`TEZORACLE_V1`)
- `chain_id`
- `oracle_address`
- `config_version` and `policy_hash`
- `publication_group` and `round`
- `valid_from` / `valid_until`
- `evidence_digest` and the ordered asset list

The contract rejects wrong domain, wrong chain, wrong oracle, reused rounds, and signatures that do not match the frozen packed bytes.

## Pause and governance

- **Pause** takes effect immediately.
- **Unpause** is delayed.
- Signer set, `N`/`M`, class minima, policy hash, and asset-set changes are delayed. They do not include TezFin `set_oracle` or TezFin aliases.

## Testnet and shadow limitations

- This phase uses Class A only. A second implementation class is not present.
- 1-of-1 is allowed only because the feed is non-authoritative.
- Live testnet origination is stretch; local/sandbox e2e is the baseline.
- Shadow output is observable evidence, not a TezFin production feed.
- External audit, 30-day final-config shadow, and TezFin governance activation are production-phase gates.

## What this repository must never contain

- Production private keys, mnemonics, or faucet dumps used as production keys
- Production RPC credentials or private endpoints
- Exploit proofs, attack runbooks, or credentials for third-party systems
- TezFin-specific `configureMaxPriceAge` / `configurePriceBounds` duplication as an authority shortcut
