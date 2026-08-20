# Evidence

**Status:** frozen for the initial TezOracle phase.  
**Digest domain:** `TEZORACLE_EVIDENCE_V1`

Every accepted batch MUST be reproducible from a versioned policy and attributable to a defined signer set. Evidence is how that is shown. Secrets, credentials, raw private keys, and authorization headers MUST NEVER appear in evidence.

There are two evidence kinds. They MUST NOT be mixed.

| Kind | Bound into `evidence_digest`? | Who produces it | May differ across signers? |
| --- | --- | --- | --- |
| Quorum-shared manifest | Yes | Disclosed with the candidate / signed payload | No. All signatures cover one digest. |
| Signer-local record | No | Each validator | Yes. Keyed by `payload_hash`. |

Mismatch of shared evidence against independent observation, or inability to verify, is **fail-closed**: do not sign, do not submit a dissenting digest as if it were the same payload.

## 1. What the digest binds

`evidence_digest` in the signed payload is `BLAKE2B-256(canonical_json(manifest))`.

The manifest binds, for **each** asset in the publication group:

- canonical `asset_id`
- every contributing source’s `source_id`, venue, market identifier, and endpoint identity
- each contributing observation’s venue timestamp, raw value, decimals, and unit
- normalized integer USD price used in aggregation
- conversion legs (for example USDT/USD) with their own timestamps
- excluded sources and a stable exclusion code
- calculation policy actually applied (aggregation, rounding, min observations)
- derived `price`, `decimals`, and oldest `observation_time`

A change to any of those fields changes the digest and invalidates signatures over the previous payload.

The on-chain contract does not re-fetch CEX or DEX data. It binds the digest and the policy hash. Validators MUST verify the manifest before signing.

## 2. Quorum-shared manifest

### 2.1 Type

Logical JSON object. Field order in the **hashed preimage** is defined by canonical JSON (§4), not by this table’s display order.

```text
SharedEvidenceManifest = {
  domain: "TEZORACLE_EVIDENCE_V1",          // string, exact
  policy_hash: hex64,                      // BLAKE2B-256 of the parameter register
  publication_group: "CORE" | "USDTZ" | "TZBTC",
  round: nat_string,                       // decimal, no leading zeros
  assets: [ AssetEvidence, ... ]           // same lexicographic order as the payload
}

AssetEvidence = {
  asset_id: string,
  price: nat_string,                       // canonical decimals
  decimals: nat,                           // JSON number, 0..18
  observation_time: int,                   // Unix seconds, oldest contributing
  calculation: {
    aggregation: "median_lower",
    rounding_mode: "half_away_from_zero",
    min_independent_observations: nat,
    contributing_source_ids: [string, ...], // lexicographic
    oldest_observation_time: int            // MUST equal observation_time
  },
  sources: [ SourceObservation, ... ],     // lexicographic by source_id
  excluded: [ ExcludedSource, ... ]        // lexicographic by source_id
}

SourceObservation = {
  source_id: string,                       // e.g. "binance"
  venue: string,                           // e.g. "Binance"
  independence_group: string,              // equal source_id for a single venue
  market_id: string,                       // e.g. "XTZUSDT"
  endpoint: string,                        // exact URL origin + path, no query secrets
  query: string,                           // canonical query string or empty
  base_asset: string,
  quote_asset: string,                     // "USD" or "USDT"
  unit: string,                            // raw quote unit: "USD" or "USDT"
  venue_observation_time: int,             // Unix seconds (converted from venue encoding)
  raw_price: nat_string,
  raw_decimals: nat,
  normalized_price: nat_string,            // USD, asset canonical decimals
  conversion: null | ConversionLeg
}

ConversionLeg = {
  via_asset_id: "USDT_USD",
  factor: nat_string,                      // USDT/USD in USDT_USD decimals
  factor_decimals: nat,
  factor_observation_time: int             // included in oldest-time calculation
}

ExcludedSource = {
  source_id: string,
  code: string,                            // stable code from §6
  detail: string                           // non-secret, may be empty
}
```

`nat_string` is a base-10 integer with no sign, no decimal point, no leading zeros unless the value is `0`. `0` is forbidden for `price`, `raw_price`, `normalized_price`, and `factor`.

`sources` contains only observations that **contributed** to the median. Attempted-but-rejected sources go in `excluded`. A source MUST NOT appear in both lists.

`contributing_source_ids` MUST be the lexicographic list of `sources[].source_id` and MUST satisfy the asset’s `min_independent_observations` using distinct `independence_group` values.

### 2.2 Per-asset binding rules

- The manifest `assets` list MUST be the exact payload group set, same order.
- Each `AssetEvidence.price`, `decimals`, and `observation_time` MUST equal the corresponding payload asset entry.
- `observation_time` MUST equal `min(venue_observation_time, conversion.factor_observation_time)` over contributing sources.
- `endpoint` identifies the approved path from the parameter register. Host aliases, HTTP vs HTTPS flips, and unapproved query parameters are a mismatch.
- Two endpoints in the same `independence_group` count as one independent observation. The manifest includes the single selected route for that venue, not both.
- DEX-derived assets additionally bind pool address, token identities, quote size, liquidity, impact, TWAP window, and per-pool observations as specified in the register. Until USDtz and tzBTC leave stub status, a non-empty DEX evidence object for those groups is still required **if** a candidate is offered; otherwise those groups fail closed and are not signed.

### 2.3 Who may assemble the shared manifest

The coordinator MAY assemble a candidate manifest. Validators MUST independently retrieve or validate the underlying observations and MUST NOT treat coordinator-supplied prices, timestamps, source status, or this manifest as authoritative.

A validator signs the payload that contains `evidence_digest` only after the checks in [OBSERVER_AGREEMENT.md](OBSERVER_AGREEMENT.md) pass against **local** observations and the **pinned** register. Signing that digest means “this disclosed manifest is consistent with my independent verification,” not “I fetched byte-identical HTTP bodies.”

Validators MUST NOT replace the digest with a privately computed alternative and still present the coordinator’s other payload fields. Either the complete payload is signed, or nothing is signed.

## 3. Signer-local record

Retained off-chain, keyed by `payload_hash = BLAKE2B-256(PACK(payload))`. Not hashed into `evidence_digest`. Required for audit; forbidden from containing secrets.

```text
SignerLocalRecord = {
  domain: "TEZORACLE_SIGNER_EVIDENCE_V1",
  payload_hash: hex64,
  signer_id: string,
  validator_class: "A" | "B",
  config_version: nat,
  policy_hash: hex64,
  software_artifact_hash: hex64,
  local_price_by_asset: { asset_id: nat_string },
  local_observation_time_by_asset: { asset_id: int },
  candidate_deviation_bps_by_asset: { asset_id: nat },
  local_sources: [ ... ],                  // independently fetched, same shape as SourceObservation
  decision: "sign" | "refuse",
  error_code: string | null,               // stable code; null iff sign
  decided_at: int                          // Unix seconds
}
```

Class B (later phase) MUST write its own local record with its own artifact hash. Reusing Class A’s local record as Class B evidence is forbidden.

## 4. Canonical JSON for `evidence_digest`

Preimage bytes are UTF-8 canonical JSON:

1. No BOM.
2. Objects: keys sorted lexicographically by UTF-8 code units; no duplicate keys.
3. Arrays: existing order is significant and MUST already be the prescribed order (do not sort as a silent repair; reject if out of order).
4. No insignificant whitespace (no spaces, no newlines).
5. Strings: JSON escaped per RFC 8259; no Unicode normalization of the unescaped text.
6. Numbers: only JSON integers that fit the field’s stated type (`decimals`, timestamps, small nats). Prices and other unbounded nats are strings (§2.1).
7. `null` is allowed only where the type says `null | …`.
8. Hex digest fields in the manifest (`policy_hash`) are 64 lowercase hex characters with **no** `0x` prefix.
9. Unknown fields: reject the manifest; do not hash a stripped copy.

```
evidence_digest = BLAKE2B-256(utf8(canonical_json(manifest)))
```

This hash is **not** Michelson `PACK`. `PACK` is reserved for the signed payload in [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md).

## 5. Verification (fail-closed)

A signer MUST refuse when any of the following hold:

| Code | Condition |
| --- | --- |
| `EVIDENCE_DOMAIN` | `domain` ≠ `TEZORACLE_EVIDENCE_V1` |
| `EVIDENCE_CANON` | JSON is not canonical, or arrays are mis-ordered |
| `EVIDENCE_POLICY` | manifest `policy_hash` ≠ pinned register hash |
| `EVIDENCE_GROUP` | group or asset set ≠ payload |
| `EVIDENCE_PRICE` | manifest price/decimals/time ≠ payload asset entry |
| `EVIDENCE_SOURCE` | a contributing source is not in the pinned allowlist |
| `EVIDENCE_ENDPOINT` | endpoint/query/market_id ≠ register binding |
| `EVIDENCE_DIGEST` | recomputed digest ≠ payload `evidence_digest` |
| `EVIDENCE_LOCAL` | independent derivation disagrees beyond `max_signer_deviation_bps` |
| `EVIDENCE_TIME` | payload/manifest `observation_time` > signer’s oldest contributing time |
| `EVIDENCE_MIN` | contributing independent venues < minimum |
| `EVIDENCE_SECRET` | any credential-shaped field present |

There is no coordinator override and no “publish anyway” path.

## 6. Stable exclusion and refusal codes

Use these strings in `excluded[].code` and signer-local `error_code`. Do not invent synonyms.

| Code | Meaning |
| --- | --- |
| `TIMEOUT` | bounded HTTP/RPC timeout |
| `HTTP_STATUS` | non-success HTTP status |
| `MALFORMED` | body, content-type, or schema mismatch |
| `OVERSIZE` | response larger than `max_response_bytes` |
| `BAD_NUMBER` | non-finite, scientific notation, negative, zero, overflow |
| `BAD_TIMESTAMP` | missing, unparsable, zero, future, or stale venue time |
| `WRONG_MARKET` | venue payload does not match pinned market identity |
| `UNAPPROVED_SOURCE` | source not in the register allowlist |
| `OUTLIER` | deviation vs robust center exceeds policy |
| `INSUFFICIENT` | remaining independent observations below minimum |
| `SET_DIVERGENCE` | remaining healthy set still exceeds `max_set_deviation_bps` |
| `BOUNDS` | derived price outside absolute min/max |
| `DEX_LIQUIDITY` | below minimum liquidity or above impact |
| `DEX_TWAP` | incomplete window, cold start, or reorganization |
| `DEX_CROSS` | cross-pool/route divergence |
| `PAUSED` | asset or oracle paused |
| `POLICY_PIN` | unknown or inactive config/policy |
| `CANDIDATE_MISMATCH` | candidate vs local derivation |
| `INTERNAL` | local failure; fail closed |

## 7. Retention

Shared manifests and signer-local records for accepted, refused, and failed rounds are retained as non-secret operational evidence. This phase does not require a particular store. Production retention, redaction review, and public dashboards are out of scope.

Test vectors that include signatures MUST use test-only keys stored apart from any production secret.
