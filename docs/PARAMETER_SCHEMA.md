# Parameter register schema

**Status:** frozen for the initial TezOracle phase.  
**Machine schema:** [`config/schema.json`](../config/schema.json)  
**Snapshot:** [`config/register.json`](../config/register.json) and [`config/assets/`](../config/assets/)

The parameter register is the only source of source allowlists, minima, deviation, aggregation, rounding, decimals, freshness, bounds, DEX parameters, and lifecycle. Those values are not request parameters. Unknown fields are rejected.

This phase does not authorize production activation. A row with lifecycle `testnet` or even a future `production` mark in git is not permission to point TezFin markets at the oracle.

## 1. Snapshot layout

```text
config/
  schema.json           JSON Schema (draft 2020-12) for the assembled snapshot
  register.json         System-level register
  assets/
    BTC_USD.json
    TZBTC_USD.json      non-authoritative stub
    USDTZ_USD.json      non-authoritative stub
    USDT_USD.json
    XTZ_USD.json
```

Assembled snapshot:

```text
{
  register: <register.json>,
  assets: {
    "<asset_id>": <that asset file>
  }
}
```

Asset object keys are canonical IDs. Files MUST be named `{asset_id}.json`. `register.assets` lists every ID exactly once. Extra files are rejected.

## 2. Lifecycle

| Value | Meaning in this repository |
| --- | --- |
| `draft` | Specified for review; not an operational feed. |
| `testnet` | May be used on testnet / local e2e. Non-authoritative for TezFin. |
| `shadow` | May be published on mainnet for comparison only. Non-authoritative. |
| `production` | Reserved. Presence in git still requires separate TezFin activation. |

Every asset also has `authoritative: boolean`. It MUST be `false` for this phase. USDtz and tzBTC MUST be `draft` with `authoritative: false` and `consumable: false`.

## 3. System register fields

| Field | Type | Role |
| --- | --- | --- |
| `schema_version` | nat | This document’s schema generation. Currently `1`. |
| `register_id` | string | `tezoracle-parameter-register` |
| `lifecycle` | enum | Register-wide lifecycle. Currently `testnet`. |
| `authoritative` | bool | MUST be `false` in this phase. |
| `domain` | string | `TEZORACLE_V1` |
| `config_version` | nat | ≥ 1. Incremented on every activating change. |
| `publication_groups` | object | Exact group → ordered `asset_ids` lists |
| `time_policy` | object | Submission window, skew, activation delay |
| `payload` | object | Integer caps shared with [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md) |
| `governance` | object | Delayed activation rules |
| `signer_environments` | object | Declared regions from which every registered endpoint MUST be probed |
| `assets` | string[] | UTF-8 code-unit lexicographic list of asset IDs present in this snapshot |

### Time policy

| Field | Current freeze | Notes |
| --- | --- | --- |
| `validity_window_seconds` | 180 | `valid_until − valid_from` cap |
| `max_clock_skew_seconds` | 5 | Future-observation tolerance |
| `activation_delay_levels` | 1 | Non-zero. Pending price not consumable in the accept level |
| `min_activation_delay_levels` | 1 | Governance cannot set delay to 0 |

### Payload caps

| Field | Value |
| --- | --- |
| `price_nat_max` | `79228162514264337593543950335` (2^96 − 1), decimal string |
| `decimals_min` | 0 |
| `decimals_max` | 18 |
| `digest_size_bytes` | 32 |

### Publication groups

Group names and ordered `asset_ids` lists are whatever the committed register contains. Names match `^[A-Z][A-Z0-9_]*$`. The payload Michelson type stays `string`; TypeScript, Python, and JSON Schema MUST NOT hard-code only `CORE`, `USDTZ`, and `TZBTC`.

This snapshot:

- `CORE`: `BTC_USD`, `USDT_USD`, `XTZ_USD`
- `USDTZ`: `USDTZ_USD`
- `TZBTC`: `TZBTC_USD`

`register.assets` is the UTF-8 code-unit lexicographic list of every ID in the snapshot: `BTC_USD`, `TZBTC_USD`, `USDTZ_USD`, `USDT_USD`, `XTZ_USD`. Do not use a locale-aware sort.

Adding a future group is a register edit plus delayed activation. It does not redesign PACK.

## 4. Asset fields

Required for every asset:

| Field | Role |
| --- | --- |
| `asset_id` | Canonical ID |
| `group` | Publication group name from the register (`^[A-Z][A-Z0-9_]*$`) |
| `lifecycle` | See §2 |
| `authoritative` | Must be false this phase |
| `consumable` | Whether any TezFin-style consumer may rely on it; false this phase |
| `decimals` | Canonical display/storage scale; `6` for USD prices |
| `unit` | Quote/unit string. Current USD prices use `USD`. Future instruments MAY use other units without changing PACK. |
| `timestamp_semantics` | How `observation_time` is defined. Current CEX rows use `venue_observation_time`. |
| `market_calendar` | Optional. Current crypto rows use `crypto_24x7`. Reserved for future calendars. |
| `benchmark_methodology` | Optional. Current CEX rows use `last_trade_median`. Reserved for future benchmarks. |
| `instrument_definition` | Optional free-form instrument class (`spot_index`, pending RWA definitions). Not an implemented RWA feed. |
| `min_independent_observations` | Minimum distinct `independence_group` values |
| `max_observation_age_seconds` | Per-source and derived-price age cap |
| `max_source_deviation_bps` | Outlier threshold vs median |
| `max_set_deviation_bps` | Remaining-set spread cap |
| `max_signer_deviation_bps` | Candidate vs local derivation |
| `aggregation` | `median_lower` |
| `rounding_mode` | `half_away_from_zero` |
| `absolute_min_price` | Inclusive, integer at `decimals`, string |
| `absolute_max_price` | Inclusive, integer at `decimals`, string |
| `max_movement_bps` | Automatic movement limit (contract exceptional path) |
| `sources` | Approved venues and exact endpoint bindings |
| `derivation` | `cex_median` \| `dex_twap_times_usd` \| `peg_factor_times_usd` |

`dex` is required when `derivation` is not `cex_median`. For stubs it MAY have `status: "pending_review"` and empty `pools`.

## 5. Source binding

Each source entry binds a single approved route:

| Field | Role |
| --- | --- |
| `source_id` | Stable ID (`binance`, `okx`, `kraken`, `coinbase`) |
| `venue` | Human venue name |
| `independence_group` | Independence key; usually equal to `source_id` |
| `adapter_status` | `initial_phase` or `stretch` |
| `market_id` | Venue symbol |
| `base_asset` / `quote_asset` | Explicit; Kraken `XBT` ≡ BTC only via this mapping |
| `endpoint` | Origin + path |
| `query` | Exact query string, no secrets |
| `method` | `GET` |
| `timeout_ms` | Bounded request timeout |
| `max_response_bytes` | Response size cap |
| `price_path` | JSON path to the decimal price string |
| `timestamp_path` | JSON path to the venue time |
| `timestamp_encoding` | `unix_ms` \| `unix_s_fractional` \| `rfc3339` |
| `quote_conversion` | `none` or `usdt_usd` |

`adapter_status: stretch` means the route is approved in policy but no Class A adapter is required to count it yet. Stretch sources do not satisfy `min_independent_observations`. This freeze marks Binance, OKX, Kraken, and Coinbase as `initial_phase`. DEX routes remain stretch/stub until separately reviewed.

Two listed markets in the same `independence_group` still count as one observation. This freeze lists **one** selected market per venue per asset.

HTTP TLS verification stays enabled. Redirects that change host are treated as `MALFORMED`.

Optional source metadata (allowed now, unused as new feed types): `source_type`, `source_lineage`, `instrument`, `unit`, `timestamp_semantics`, `market_calendar`, `benchmark_methodology`. These document venue/instrument identity. They do not implement RWA feeds.

### Source health and deployment regions

Listing an HTTPS URL is an allowlist identity, not a health attestation.

Each source has `health`:

| Field | Role |
| --- | --- |
| `probe_status` | `untested` \| `reachable` \| `geo_blocked` \| `failed` |
| `last_http_status` | Last probe status, or `null` |
| `known_restriction` | Optional. `http_451` for venues known to geo-block some regions |
| `eligible_for_production_quorum` | MUST be `false` unless a 2xx probe from a declared signer region succeeded |
| `notes` | Non-secret operator text |

`register.signer_environments` records the intended Class A operating regions. This freeze uses `status: "undeclared"` and an empty `regions` list. Until regions are declared and every registered endpoint is probed from each of them:

- every current source remains `probe_status: "untested"`
- `eligible_for_production_quorum` is `false`
- an untested endpoint MUST NOT be counted as a healthy source in any mode
- Class A derivation fail-closes rather than treating fixture or live 200 responses as health attestations

`api.binance.com` is known to return HTTP 451 from at least one expected operating region. Binance rows carry `known_restriction: "http_451"`. A signer that observes 451, timeout, TLS failure, or any non-2xx MUST exclude that source (`HTTP_451` / `HTTP_STATUS` / `TIMEOUT`) and fail closed if remaining healthy independent observations fall below `min_independent_observations`. Stretch adapters never count toward the minimum.

Operator probe tool: `npx tsx scripts/probe-source-endpoints.ts`. It is not a CI gate; geo-blocking is environment-specific. CI tests the 451 classification with fixtures.

## 6. DEX fields (USDtz / tzBTC)

Required conceptually; stubbed until review:

| Field | Role |
| --- | --- |
| `status` | `pending_review` until separately approved |
| `pools` | Exact pool addresses, token addresses, token IDs, decimals, expected code |
| `quote_size` | Executable test amount |
| `min_liquidity` | Minimum usable liquidity |
| `max_price_impact_bps` | Quote impact cap |
| `twap_window_seconds` | Minimum TWAP window |
| `min_twap_observations` | Minimum independently maintained samples |
| `cross_pool_deviation_bps` | Cross-pool / cross-route cap |
| `cold_start_policy` | `fail_closed` |
| `degraded_one_pool_mode` | `false` |

Empty `pools` and null numeric DEX fields mean “not approved.” They MUST NOT be treated as wildcards.

## 7. Policy hash

```
preimage = utf8(canonical_json(assembled_snapshot))
policy_hash = BLAKE2B-256(preimage)
```

Canonical JSON rules match [EVIDENCE_SPEC.md](EVIDENCE_SPEC.md) §4 (sorted object keys, compact, RFC 8259 strings, unknown fields forbidden). `price_nat_max` and price bounds stay decimal strings.

Signers and the contract pin this 32-byte hash. A payload whose `policy_hash` is not the active hash is rejected.

Do not store a self-referential hash inside the hashed snapshot.

## 8. Review, approval, and delayed activation

1. Change asset or system parameters only by editing these files in version control.
2. Review the diff as a risk-increasing change when it widens bounds, lowers minima, adds sources/assets, shortens windows, or reduces activation delay.
3. Merge does not activate. Activation is a delayed on-chain configuration update to a new `config_version` and the new `policy_hash`.
4. Emergency pause is immediate and is not a parameter-register shortcut for unpause.
5. USDtz and tzBTC require a separate review of pools, liquidity, and peg policy before `lifecycle` may leave `draft` or `consumable` may become `true`.
6. Promoting any asset to `production` or `authoritative: true` is out of scope for this phase.

Record of changes is git history of `config/`. Do not edit numbers in running services without a register commit.

## 9. Current freeze summary

| Asset | Lifecycle | Derivation | Min obs | Decimals |
| --- | --- | --- | --- | --- |
| `USDT_USD` | testnet | CEX median, direct USD | 3 | 6 |
| `XTZ_USD` | testnet | CEX median, USD and USDT-adjusted | 3 | 6 |
| `BTC_USD` | testnet | CEX median, USD and USDT-adjusted | 3 | 6 |
| `USDTZ_USD` | draft | DEX TWAP × USDT/USD (stub) | n/a until pools exist | 6 |
| `TZBTC_USD` | draft | peg factor × BTC/USD (stub) | n/a until routes exist | 6 |

Initial-phase adapters: Binance, OKX, Kraken, and Coinbase — the same four CEX venues as the mainnet allowlist. `min_independent_observations` is **3**, matching the security baseline (≥3 healthy independent venues). Four listed adapters mean one missing or excluded CEX still leaves a valid CORE quorum; two remaining observations fail closed (`INSUFFICIENT`). Outlier exclusion is allowed only when the remaining set still meets that minimum.

This is a register value, not a request flag. Lowering it further is a delayed, risk-increasing change.
