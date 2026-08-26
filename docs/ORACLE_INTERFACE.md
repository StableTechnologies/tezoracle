# TezFin / TezOracle interface

**Status:** testnet and non-authoritative shadow only. This document does **not** authorize TezFin `set_oracle`, production reliance, or any TezFin code in this repository.

TezOracle is a generic N-of-M price publisher. TezFin is a consumer. The split is:

```text
Comptroller  ->  TezFinOracle (TezFin repo)  ->  TezOracle views (this repo)
```

On-chain contract behavior: [CONTRACT_SPEC.md](CONTRACT_SPEC.md). Canonical signed IDs: [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md). Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. What TezOracle exposes

### 1.1 Accepted price and observation time

The public consumer surface is a mature quote only:

```
pair (nat %price) (timestamp %observation_time)
```

| View | Parameter | Result |
| --- | --- | --- |
| `get_price` | `string` canonical `asset_id` | `(nat price, timestamp observation_time)` |
| `get_price_with_timestamp` | same | same pair (TezFin-facing name; identical result) |

Both views:

- Return only a **mature** active quote. A pending quote accepted at level `L` is not visible until `now_level ≥ L + activation_delay_levels`.
- Use payload **market observation time** (oldest contributing venue observation), never Tezos inclusion time and never `now` at view call.
- Fail closed (`PAUSED`, `ASSET_PAUSED`, `ASSET_ID`, `NO_PRICE`) rather than returning zero, a pending quote, or a last-good fallback invented at view time.

`get_price_with_timestamp` exists so the existing TezFin wrapper can call a named view. It is **not** a second authority path and must not grow TezFin-specific parameters.

The existing TezFin wrapper historically consumes `(nat, timestamp)` from upstream and returns `(timestamp, nat)` to Comptroller. Tuple **order conversion** is a TezFin adapter concern. This contract does not return `(timestamp, nat)`.

### 1.2 Configuration version for downstream verification

Every accepted quote is bound to the active `config_version` and `policy_hash` in contract storage. Those fields are public Tezos storage. Downstream shadow observers, relayers, and TezFin operators MAY read them to confirm which register snapshot produced the quote.

| Field | Meaning |
| --- | --- |
| `config_version` | Active on-chain configuration version (`nat` ≥ 1). Signed payloads must match it. |
| `policy_hash` | 32-byte BLAKE2B of the pinned parameter register. |

These fields are **verification metadata**. They are not a substitute for TezFin freshness, bounds, aliases, or `getValidatedPrice`. TezFin lending paths MUST NOT treat a matching `config_version` as approval to skip consumer checks.

This contract does **not** expose TezFin entrypoints that write consumer policy (`configureMaxPriceAge`, `configurePriceBounds`, alias maps, `set_oracle`).

### 1.3 Canonical asset identifiers

View arguments are canonical register IDs only:

| `asset_id` | Group | Initial posture |
| --- | --- | --- |
| `BTC_USD` | `CORE` | draft / testnet, non-authoritative |
| `USDT_USD` | `CORE` | draft / testnet, non-authoritative |
| `XTZ_USD` | `CORE` | draft / testnet, non-authoritative |
| `USDTZ_USD` | `USDTZ` | non-authoritative stub |
| `TZBTC_USD` | `TZBTC` | non-authoritative stub |

Legacy strings such as `XTZUSDT`, `BTCUSDT`, `TZBTCUSDT`, `USDTUSDT`, and `*-USD` market names MUST NOT appear in the signed payload or as this contract’s view keys. Mapping those strings to canonical IDs is TezFin work. `TZBTCUSDT` and `BTCUSDT` MUST remain distinct TezFin aliases; this contract never equates `TZBTC_USD` with `BTC_USD`.

## 2. What TezOracle does not expose

Do not add the following to this repository or to the N-of-M contract without a separately reviewed amendment:

| Surface | Why it stays out |
| --- | --- |
| `configureMaxPriceAge` | Comptroller / TezFinOracle consumer freshness. Duplicating it upstream would split authority and invite weakening one copy. |
| `configurePriceBounds` | Comptroller / TezFinOracle consumer bounds. Same split. |
| Alias register / symbol rewrite | TezFin market names and wrapper mapping (`XTZ` → `XTZUSDT` → `XTZ_USD`). |
| Decimal / unit normalization for fTokens | TezFin wrapper and Comptroller. |
| `getValidatedPrice` | TezFinOracle: freshness, bounds, and movement after the upstream view. |
| `set_oracle` / `setPriceOracleAndTimeDiff` | TezFin governance of which contract Comptroller trusts. |
| TezFin wrapper or Comptroller source | Lives in `StableTechnologies/TezFin`. |

Oracle-level **register** absolute min/max and `max_observation_age_seconds` in [PARAMETER_SCHEMA.md](PARAMETER_SCHEMA.md) are publication fail-closed checks on `submit`. They are not `configurePriceBounds` or `configureMaxPriceAge`. TezFin MUST keep its own consumer max-age and bounds even when the oracle already rejected a stale or out-of-range publication.

## 3. TezFin responsibilities (`StableTechnologies/TezFin`)

All of the following stay in TezFin. This phase does not implement them here.

### 3.1 Aliases

Keep an explicit, versioned alias map from market / wrapper strings to canonical TezOracle IDs. Do not infer `tzBTC → BTC`. Unknown aliases fail closed.

### 3.2 Normalization

Keep fToken / market decimal and unit conversion on the consumer side. TezOracle prices are integer fixed-point in the register `decimals` for that canonical ID (initial USD quotes use 6).

### 3.3 Maximum age

Keep `configureMaxPriceAge` (or equivalent) on TezFinOracle / Comptroller. Compare consumer `now` against the **observation** timestamp returned by the upstream view. Because that timestamp is market time, not inclusion time, existing freshness checks remain meaningful if the wrapper does not substitute block time.

### 3.4 Bounds and movement

Keep `configurePriceBounds` and Comptroller movement / sanity checks. Do not weaken them because the oracle has register bounds.

### 3.5 `getValidatedPrice`

TezFinOracle continues to:

1. Map the consumer asset argument through the alias register to a canonical ID (or fail).
2. Call upstream `get_price_with_timestamp` and receive `(nat price, timestamp observation_time)`.
3. Apply max age, bounds, and any wrapper-local validation.
4. Return the validated quote to Comptroller (including any historical `(timestamp, nat)` order the Comptroller already expects).

### 3.6 Production pointer

TezFin MUST NOT point markets at a TezOracle origination until a separate production authorization. Testnet and shadow publications are non-authoritative. USDtz and tzBTC remain non-authoritative until separately reviewed.

## 4. Integration contract (no TezFin code here)

A later TezFin change, when authorized, should treat this repository as an upstream view contract only:

1. Originate / select a TezOracle KT1 (testnet or shadow).
2. Point TezFinOracle at that KT1 **without** copying age, bounds, or alias logic into TezOracle.
3. Call `get_price_with_timestamp` with a **canonical** ID after TezFin alias mapping.
4. Continue to run `getValidatedPrice` and Comptroller safeguards on the returned observation time.

If the current TezFin wrapper cannot call this view without `configureMaxPriceAge` / `configurePriceBounds` on the **upstream** address, the adapter that provides those entrypoints belongs in TezFin (or a separately reviewed TezFin-owned shim). It is not an authority shortcut and MUST NOT land in this repo as duplicated consumer policy.

## 5. Failure and pause

| Upstream condition | Consumer expectation |
| --- | --- |
| Global or per-asset pause | View fails; TezFin must not invent a price |
| No mature quote yet (`NO_PRICE`) | Fail closed; pending is invisible |
| Unknown canonical ID | `ASSET_ID`; aliases are not retried on-chain |
| Observation older than TezFin max age | TezFin rejects even if the oracle still serves the quote |
| Price outside TezFin bounds | TezFin rejects even if the oracle accepted publication |

Pause is immediate on TezOracle. Unpause and risk-increasing config are delayed. TezFin pause / market disable remains an independent consumer control.

## 6. Acceptance

This boundary is met when:

- Upstream public quotes are mature `(nat price, timestamp observation_time)` using observation time.
- `config_version` / `policy_hash` are readable for verification and are not TezFin consumer configuration.
- This repository contains no `configureMaxPriceAge`, `configurePriceBounds`, alias tables, `getValidatedPrice`, or `set_oracle`.
- TezFin retains aliases, normalization, max age, bounds, and `getValidatedPrice`.
