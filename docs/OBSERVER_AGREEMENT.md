# Observer agreement

**Status:** frozen for the initial TezOracle phase.

Two independent validators MUST be able to implement this policy without treating a coordinator-selected price as authoritative. Policy values come only from the pinned parameter register ([PARAMETER_SCHEMA.md](PARAMETER_SCHEMA.md)). A request may trigger a round and may carry a candidate. A request MUST NOT raise a tolerance, lower a source count, replace aggregation, change decimals, select weaker sources, or make an old observation fresh.

Fail closed when verification is impossible or mismatched. There is no degraded “publish anyway” path. One-pool USDtz degraded mode is not enabled.

## 1. Roles

| Role | May do | Must not do |
| --- | --- | --- |
| Coordinator | Trigger a round; optionally assemble a candidate payload and shared evidence manifest; collect signatures | Hold signing keys; choose policy; require signers to accept its price |
| Validator | Fetch observations; derive; verify candidate; sign the frozen payload | Accept request-supplied policy; sign on mismatch |
| Relayer | Transport already-signed bytes | Mutate packed bytes; hold signing keys |

Validators independently **derive** a local result and **verify** any candidate under this agreement. They never sign a price they cannot reproduce within the pinned signer deviation.

## 2. Clocks and observation windows

Venue observation time is the timestamp carried by the approved source response, converted to Unix seconds by the register’s timestamp encoding. Local HTTP receipt time is not a substitute.

Off-chain `now` is the validator’s clock. On-chain `now` is the block timestamp. Both apply the same numeric bounds.

| Check | Rule |
| --- | --- |
| Positive | `observation_time` ≥ 1 |
| Future | reject source if `venue_time` > `now` + `max_clock_skew_seconds` |
| Age | reject source if `now` − `venue_time` > asset `max_observation_age_seconds` |
| Derived time | asset `observation_time` = minimum contributing venue time, including conversion-leg times |
| Payload vs local | candidate `observation_time` MUST equal the shared-manifest oldest time and MUST be ≤ the signer’s locally computed oldest contributing time |
| Regression | on-chain reject if `observation_time` < last **accepted** observation time for that asset |
| Submission window | `valid_from` ≤ chain `now` ≤ `valid_until` |
| Window length | `valid_until` − `valid_from` MUST be ≤ register `validity_window_seconds` and ≥ 1 |

`max_clock_skew_seconds` exists only to tolerate small venue/clock error. It is not a freshness extension.

Republishing the same economic value in a new round MUST use newly obtained observations. Copying a previous `observation_time` forward to refresh freshness is forbidden.

## 3. Source identity and independence

- Only register-allowlisted `source_id` + `market_id` + `endpoint` tuples may contribute.
- Timeouts, retries, and failover MUST NOT substitute an unapproved source.
- An untested endpoint is not a healthy source in **any** mode (testnet, shadow, production). Class A `fetchSource` / `derivePublicationGroup` apply the register health gate before a venue observation may contribute. A live HTTP 200 does not override `probe_status: untested`; the snapshot must be updated after a probe from the intended signer environment.
- HTTP 451 (including the known `api.binance.com` geo-restriction), other non-2xx statuses, timeouts, and TLS failures exclude that source. If remaining independent healthy observations fall below `min_independent_observations`, fail closed (`INSUFFICIENT` / `HTTP_451` / `UNTESTED`). There is no “skip the blocked venue and publish anyway” path.
- `eligible_for_production_quorum` is an additional gate when register `lifecycle` is `production`. It MUST stay false until the endpoint has been probed from every declared signer region. Testnet derivation still requires `probe_status: reachable` and a live 2xx; it does not require the production flag.
- Two endpoints that share `independence_group` (same venue or same upstream) count as **one** independent observation. Prefer the register’s `route_preference` (direct USD, then USDT-adjusted) and keep a single selected route in shared evidence.
- A USDT-adjusted route is one venue observation even though it multiplies by USDT/USD.
- Core-group derivation order:
  1. `USDT_USD` from **direct USD** markets only (no USDT-quoted circularity).
  2. `XTZ_USD` and `BTC_USD` from direct USD routes and/or USDT routes adjusted by the `USDT_USD` derived in this same round.
- The USDT/USD factor’s observation time is a contributing time of every asset that used it.

USDtz and tzBTC are separate publication groups. Failure of either MUST NOT block a valid `CORE` update. In this phase those groups are non-authoritative stubs: do not consume them as TezFin production feeds.

## 4. Parsing and arithmetic

Canonical arithmetic is integer / exact fixed-point. JavaScript `number`, `parseFloat`, implicit coercion, `NaN`, `Infinity`, and scientific notation are rejected on the canonical path.

Decimal-string parse (CEX prices):

1. Entire remaining body field is a base-10 string.
2. Optional leading `-` → reject (prices are positive).
3. Reject empty string, `+`, spaces, commas, exponent markers (`e`, `E`), and more than one `.`.
4. Split integer and fractional parts. Integer part MAY be `"0"`; a completely empty integer part (`".5"`) is rejected.
5. Interpret as a rational `p / 10^f` where `f` is the fractional-digit count.
6. Convert to the target decimal scale with rounding mode `half_away_from_zero` (§6).
7. Reject if the result is 0 or > `price_nat_max`.

Timestamps:

- Binance `time` and OKX `ts`: integer milliseconds → `floor_div(ms, 1000)` seconds. Reject if not an integer JSON number/string of digits.
- Coinbase `time`: RFC3339 / ISO-8601 UTC → Unix seconds (fractional seconds truncated toward zero).
- Kraken trade time: seconds as a decimal string or JSON number; truncate toward zero to Unix seconds.

## 5. Minimum observations and deviation

For each asset, after parsing and time checks:

1. Collect healthy observations, at most one per `independence_group`.
2. If count < `min_independent_observations`, fail closed (`INSUFFICIENT`).
3. Let `M` be `median_lower` of the collected `normalized_price` values (§6).
4. Exclude a source as `OUTLIER` when  
   `abs(price − M) * 10000 > max_source_deviation_bps * M`  
   (integer compare; no division).
5. If remaining count < `min_independent_observations`, fail closed (`INSUFFICIENT`). Outlier exclusion is allowed only when the minimum still holds.
6. Recompute `M'` = `median_lower` of the remaining set.
7. Let `lo` and `hi` be min and max of the remaining set. Fail closed (`SET_DIVERGENCE`) if  
   `(hi − lo) * 10000 > max_set_deviation_bps * M'`.
8. Round `M'` to asset `decimals` if it is not already at that scale (it should be). Check absolute bounds (`BOUNDS`).
9. The asset price is `M'`. The asset `observation_time` is the minimum contributing time among remaining sources (and their conversion legs).

USDT depeg: `USDT_USD` uses tighter deviation and bounds than XTZ/BTC. A USDT failure fails `CORE` as a group (shared inputs). It does not fail the `USDTZ` or `TZBTC` groups by itself; those groups have their own batches.

## 6. Aggregation and rounding

`aggregation` is `median_lower`:

- Sort remaining prices ascending (integer compare).
- Let `n` be the length, `n ≥ 1`.
- Odd `n`: take index `(n - 1) / 2` (0-based).
- Even `n`: take the **lower median**, index `n / 2 - 1`. Do not average the two central values.

This avoids a hidden mean and extra rounding on even sets.

`rounding_mode` is `half_away_from_zero` and applies when scaling a value from `src_decimals` to `dst_decimals`:

- If `src_decimals` = `dst_decimals`: identity.
- If `src_decimals` < `dst_decimals`: multiply by `10^(dst − src)`.
- If `src_decimals` > `dst_decimals`: let `d = 10^(src − dst)`, `q = value / d`, `r = value % d`.  
  If `2*r > d`, or `2*r = d` and `q > 0`, then `q + 1`, else `q`. Prices are positive, so this is half away from zero.

USDT-adjusted route, all values already in canonical `d` decimals:

```
usd_price = round_half_away(xtz_usdt * usdt_usd, 10^d)
```

that is `multiply` then `divide` by `10^d` with the mode above. Do not divide first.

## 7. Round creation and monotonicity

Rounds are **per publication group**.

- The first accepted round for a group MUST be ≥ 1.
- Each later accepted round MUST be strictly greater than the last accepted round for that group.
- Skipping rounds after an outage is allowed.
- Replaying or reordering an accepted round is not.
- Off-chain, each signer tracks `last_signed_round[group]` and refuses `round ≤ last_signed_round[group]`.
- `valid_from` / `valid_until` are set for that round only. They do not move an old observation.

The coordinator MAY start a round on a schedule or public trigger when the previous window has ended or the previous round is confirmed. Validators MAY refuse a trigger. Absence of the coordinator MUST NOT prevent a validator from deriving locally and refusing to sign a bad candidate; publication then depends on an independently assembled, correctly signed payload and a permissionless relayer.

## 8. Candidate handling

A candidate, if present, is the complete logical payload plus the shared evidence manifest.

Each validator:

1. Load the locally pinned register. Reject unknown or inactive `config_version` / `policy_hash`.
2. Ignore any request fields that look like policy (sources, mins, deviation, aggregation, decimals, age, DEX parameters, signer tolerance). Unknown fields → refuse (`POLICY_PIN` / INV-004).
3. Independently retrieve approved observations.
4. Derive local prices and oldest times under §§3–6.
5. Verify shared evidence and `evidence_digest` per [EVIDENCE_SPEC.md](EVIDENCE_SPEC.md).
6. For each asset, refuse unless  
   `abs(candidate_price − local_price) * 10000 ≤ max_signer_deviation_bps * local_price`.
7. Refuse if candidate `observation_time` > local oldest contributing time, or if it disagrees with the manifest minimum.
8. Verify domain, chain, oracle address, group set, decimals, round, and validity window.
9. On success: write signer-local evidence, sign `PACK(payload)` only.
10. On any failure: write a refusal record with a stable code, do not sign.

`max_signer_deviation_bps` is pinned per asset in the register. A request cannot widen it. Zero is a valid policy where data are deterministic (for example identical mocked vectors). Testnet CEX values are small and explicit.

If no candidate is supplied, a validator MAY still derive and, in later tooling, emit its own payload. Other signers must still independently verify that payload. The coordinator is never the source of truth.

## 9. DEX-derived assets (stubs)

USDtz and tzBTC policies in this phase are non-authoritative stubs. Agreement rules that will apply once those policies are reviewed:

- No constant peg and no coordinator-selected haircut.
- Executable quotes, minimum liquidity, bounded impact, independently maintained TWAP, cold-start failure, cross-pool/route comparison, oldest contributing time.
- No one-pool degraded mode unless a later delayed governance version enables it.
- USDtz: `USDTZ/USDT` TWAP × `USDT_USD`. tzBTC: `BTC_USD` × independently observed `TZBTC/BTC` peg factor.

Until that review, validators MUST refuse `USDTZ` and `TZBTC` candidates for any authoritative or TezFin-consumed purpose. Shadow publication of those groups, if any, remains non-authoritative and fail-closed on incomplete DEX policy.

## 10. Pause and governance interaction

- Immediate pause: do not sign; contract rejects submit.
- Unpause and risk-increasing policy changes activate only after the configured delay and a new `config_version` / `policy_hash`. Signers pin the new register only when it is the active version.
- A pending policy MUST NOT be used to validate a payload that still names the old hash, or vice versa.
