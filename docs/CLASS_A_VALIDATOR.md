# Class A TypeScript validator

**Status:** implemented for the initial TezOracle phase.  
**Class:** `A`  
**Language:** TypeScript on Node.js 22+  
**Authority:** testnet and non-authoritative shadow only. This is not a production signer.

Class A independently retrieves approved CEX observations, derives prices under the pinned parameter register, verifies any candidate, and signs only frozen `PACK(payload)` bytes. It never accepts request-supplied policy. It never signs on mismatch.

Coordinator and relayer documentation is separate. Class B (Rust) is out of scope.

## 1. Boundaries

| May do | Must not do |
| --- | --- |
| Fetch the four register-allowlisted CEX venues | Fetch an unapproved host, path, or query |
| Derive under the locally pinned register | Accept sources, minima, deviation, aggregation, decimals, or age from a request |
| Verify a candidate and refuse with a stable code | Treat a coordinator price, timestamp, or evidence as authoritative |
| Sign `PACK(payload)` with a testnet key from runtime config | Hold a production key; sign a digest other than the frozen packed bytes |
| Track `last_signed_round` per publication group | Reuse or reorder a locally signed round |

The validator holds the testnet signing key. The coordinator and relayer hold none.

USDtz and tzBTC groups are draft stubs. Class A refuses those groups (`POLICY_PIN`) until a separately reviewed DEX policy exists.

## 2. Observation model

A venue attempt is either one contributing observation or one excluded source. It is never both.

```text
RawVenueQuote = { priceText, timestampRaw, reportedMarketId? }

SourceObservation = evidence SourceObservation
  (source_id, venue, independence_group, market_id, endpoint, query,
   base_asset, quote_asset, unit, venue_observation_time,
   raw_price, raw_decimals, normalized_price, conversion)

ExcludedSource = { source_id, code, detail }
```

`venue_observation_time` is the venue timestamp converted to Unix seconds. HTTP receipt time is not a substitute.

`normalized_price` is USD at the asset’s canonical decimals. A USDT-quoted route multiplies by this round’s derived `USDT_USD` and remains **one** independent observation. The USDT factor’s observation time is a contributing time of that route.

Two routes in the same `independence_group` count as one observation. This freeze lists one selected market per venue per asset.

## 3. Adapter interface

```text
SourceAdapter.parse(source, json) -> RawVenueQuote | excluded
HttpTransport(request) -> { status, body, contentType, finalUrl }
```

Adapters bind venue identity and response schema. They do not choose policy. Shared HTTP, JSON-path, decimal, and timestamp helpers live beside the adapters; each venue still has its own schema checks.

Transport rules:

- TLS verification stays enabled.
- Timeouts are the register `timeout_ms`. Timeout or unavailability → `TIMEOUT`.
- Response larger than `max_response_bytes` → `OVERSIZE`.
- Non-success HTTP status → `HTTP_STATUS`.
- Redirect that changes host → `MALFORMED`.
- Content-type that is present and not JSON → `MALFORMED`.
- Credentials never appear in the URL, query, evidence, or logs.

CI uses a deterministic mock transport. Live HTTP is for local/testnet operation only.

## 4. Approved CEX adapters

The same four venues as the mainnet allowlist. Endpoints and paths are the register bindings, not these examples.

| `source_id` | Venue | Schema | Price | Time |
| --- | --- | --- | --- | --- |
| `binance` | Binance | JSON array of trades | string at `0.price` | integer ms at `0.time` |
| `okx` | OKX | `{ code: "0", data: [...] }` | string at `data.0.last` | integer-digit ms at `data.0.ts` |
| `kraken` | Kraken | `{ error: [], result: { <pair>: trades } }` | string at `result.<pair>.0.0` | fractional-second string at `result.<pair>.0.2` |
| `coinbase` | Coinbase Exchange | ticker object | string at `price` | RFC3339 UTC at `time` |

Kraken `XBTUSD` maps to BTC only through the register `base_asset: "BTC"` and `result_pair_key: "XXBTZUSD"`. That mapping is not a tzBTC alias.

OKX `instId` and a Coinbase `product_id` (when present) must equal the pinned `market_id` (`WRONG_MARKET`).

### Coinbase XTZ/USDT bridge

Coinbase Exchange lists `XTZ-USD` and `USDT-USD`. It does not list a direct `XTZ-USDT` product. This freeze therefore selects Coinbase `XTZ-USD` as a **direct USD** route (`quote_conversion: none`).

If a later register row needs a Coinbase XTZ/USDT value, it is:

```text
XTZ/USDT = round_half_away_from_zero(XTZ/USD ÷ USDT/USD)
```

at the asset decimals, using the same integer division as [OBSERVER_AGREEMENT.md](OBSERVER_AGREEMENT.md) §6. That synthetic pair is not a second independence group and is not the current CORE route.

## 5. Derivation

Policy comes only from the pinned snapshot (`config/register.json` + `config/assets/`). `policy_hash = BLAKE2B-256(canonical_json(snapshot))`.

CORE order:

1. Observe and derive `USDT_USD` from **direct USD** markets only.
2. Observe `XTZ_USD` and `BTC_USD`. Apply `usdt_usd` conversion using the `USDT_USD` derived in this same round.
3. If `USDT_USD` fails, the CORE group fails. `USDTZ` and `TZBTC` are not failed by that result; those groups are refused independently as stubs.

For each asset, after parse and time checks ([OBSERVER_AGREEMENT.md](OBSERVER_AGREEMENT.md) §§2–6):

1. Keep at most one observation per `independence_group`.
2. Fail `INSUFFICIENT` if healthy count < `min_independent_observations` (currently **3** for CORE). Four listed venues mean one missing CEX does not block a healthy CORE update.
3. `median_lower` of `normalized_price`.
4. Exclude `OUTLIER` vs that median. Exclusion is allowed only if the remaining count still meets the minimum.
5. Recompute the lower median. Fail `SET_DIVERGENCE` if the remaining min/max spread exceeds `max_set_deviation_bps`.
6. Fail `BOUNDS` if the price is outside `[absolute_min_price, absolute_max_price]` or is 0 / above `price_nat_max`.
7. Asset `observation_time` is the minimum contributing venue time, including conversion-leg times.

Arithmetic is integer / exact fixed-point. JavaScript `number`, `parseFloat`, scientific notation, and implicit coercion are rejected on the canonical path.

## 6. Evidence

On a successful CORE derivation the validator builds the quorum-shared manifest in [EVIDENCE_SPEC.md](EVIDENCE_SPEC.md) and sets `evidence_digest = BLAKE2B-256(canonical_json(manifest))`.

Signing that digest means the disclosed manifest is consistent with independent verification, not that HTTP bodies were byte-identical.

Each decision also writes a signer-local record keyed by `payload_hash = BLAKE2B-256(PACK(payload))`. That record is not hashed into `evidence_digest` and must not contain secrets.

## 7. Candidate verification

A candidate is exactly `{ payload, evidence }`. Any field that looks like policy (sources, minima, deviation, aggregation, decimals, age, DEX parameters, signer tolerance) is `POLICY_PIN`. Unknown fields are refused.

The validator:

1. Loads the locally pinned register. Rejects unknown `config_version` / `policy_hash`.
2. Independently retrieves and derives.
3. Checks the shared manifest and recomputed `evidence_digest`.
4. For each asset, requires  
   `abs(candidate_price − local_price) * 10000 ≤ max_signer_deviation_bps * local_price`.
5. Requires candidate `observation_time` = manifest oldest time and ≤ the locally computed oldest contributing time.
6. Checks domain, chain, oracle, group set, decimals, round, and validity window (`valid_until − valid_from` ≤ register cap).
7. Signs `PACK(payload)` only, or writes a refusal and does not sign.

There is no degraded “publish anyway” path.

## 8. Signing and rounds

- Signatures cover the frozen packed bytes from `src/packing`. Implementations must not silently reorder or normalize fields.
- The testnet secret is `TEZORACLE_SIGNER_SECRET_KEY` (runtime only; never committed).
- Off-chain `last_signed_round[group]` refuses `round ≤ last`.
- Golden-vector signing tests reuse the test-only ed25519 key in `tests/packing/keys/`. That key is not production material.

## 9. CLI

```bash
npm run validator -- derive  --group CORE [--config dir] [--fixtures file] [--now unix]
npm run validator -- verify  --candidate file [--config dir] [--fixtures file] [--now unix]
npm run validator -- sign    --candidate file [--config dir] [--fixtures file] [--now unix] [--state file]
```

| Flag / env | Role |
| --- | --- |
| `--config` | Parameter-register directory. Default `./config`. |
| `--fixtures` | Deterministic HTTP map (CI / local). Omit to use live HTTPS. |
| `--now` | Unix-seconds clock override for tests. |
| `--candidate` | `{ payload, evidence }` JSON. |
| `--state` | Local round-state JSON. Also `TEZORACLE_ROUND_STATE_PATH`. |
| `TEZORACLE_SIGNER_SECRET_KEY` | Testnet `edsk...` for `sign` only. |
| `TEZORACLE_SIGNER_ID` | Signer-local record id. Default `class-a`. |
| `TEZOS_CHAIN_ID` / `ORACLE_ADDRESS` | Optional; used when `derive` emits a payload envelope. |

`--fixtures` is the supported CI path. Live venue calls are optional local operation and are not required for a green build.

## 10. Failure codes

Exclusion and refusal codes are the stable strings in [EVIDENCE_SPEC.md](EVIDENCE_SPEC.md) §6. Do not invent synonyms. Local round reuse is recorded as `INTERNAL` with a non-secret detail.

## 11. Out of scope

- Production keys, endpoints, or TezFin `set_oracle`
- Rust Class B and A1/A2/B1/B2 isolation
- DEX TWAP for USDtz / tzBTC
- Coordinator and relayer processes
