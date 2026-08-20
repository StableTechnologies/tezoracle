# Canonical signed payload

**Status:** frozen for the initial TezOracle phase.  
**Domain:** `TEZORACLE_V1`  
**Packing implementations:** frozen against `tests/packing/vectors/`. Signing product code is still later work.

This document is the signed meaning of an oracle update. Two independent validators and the Michelson contract MUST construct the same `PACK` bytes from the same logical payload. No requester, coordinator, or relayer may add, drop, reorder, or reinterpret fields.

Where this document conflicts with earlier drafts that used `TEZFIN_ORACLE_V1` or a per-asset on-chain `evidence_digest`, this document controls. TezOracle is a generic oracle; TezFin remains a consumer.

## 1. Michelson type

Right-comb nested pairs. Field annotations are required in source types for review. Annotations do **not** appear in `PACK` bytes. Comb layout **does** appear in `PACK` bytes and is frozen.

```
pair (string %domain)
     (pair (chain_id %chain_id)
           (pair (address %oracle_address)
                 (pair (nat %config_version)
                       (pair (bytes %policy_hash)
                             (pair (string %publication_group)
                                   (pair (nat %round)
                                         (pair (timestamp %valid_from)
                                               (pair (timestamp %valid_until)
                                                     (pair (bytes %evidence_digest)
                                                           (list %assets
                                                              (pair (string %asset_id)
                                                                    (pair (nat %price)
                                                                          (pair (nat %decimals)
                                                                                (timestamp %observation_time))))))))))))))
```

Asset entry comb layout:

```
(asset_id, (price, (decimals, observation_time)))
```

Payload comb layout, inner to outer:

```
(domain,
 (chain_id,
  (oracle_address,
   (config_version,
    (policy_hash,
     (publication_group,
      (round,
       (valid_from,
        (valid_until,
         (evidence_digest, assets))))))))))
```

SmartPy equivalent (normative layout, not yet the implementation):

```python
TAssetEntry = sp.TRecord(
    asset_id=sp.TString,
    price=sp.TNat,
    decimals=sp.TNat,
    observation_time=sp.TTimestamp,
).layout(("asset_id", ("price", ("decimals", "observation_time"))))

TPayload = sp.TRecord(
    domain=sp.TString,
    chain_id=sp.TChainId,
    oracle_address=sp.TAddress,
    config_version=sp.TNat,
    policy_hash=sp.TBytes,
    publication_group=sp.TString,
    round=sp.TNat,
    valid_from=sp.TTimestamp,
    valid_until=sp.TTimestamp,
    evidence_digest=sp.TBytes,
    assets=sp.TList(TAssetEntry),
).layout(
    ("domain",
     ("chain_id",
      ("oracle_address",
       ("config_version",
        ("policy_hash",
         ("publication_group",
          ("round",
           ("valid_from",
            ("valid_until",
             ("evidence_digest", "assets"))))))))))
)
```

Do not replace `chain_id` with `string` or `bytes`. Do not replace `address` with `string`. Do not replace `timestamp` with `nat` or milliseconds. Do not add a per-asset `evidence_digest` to the on-chain entry: the payload-level digest binds the off-chain manifest that already records each asset’s sources and observations ([EVIDENCE_SPEC.md](EVIDENCE_SPEC.md)).

## 2. Field table

| Order | Field | Michelson | Constraints |
| ---: | --- | --- | --- |
| 1 | `domain` | `string` | Exactly `TEZORACLE_V1`. ASCII, length 12, no BOM, no trailing NUL, no Unicode normalization. |
| 2 | `chain_id` | `chain_id` | Exact destination Tezos network. Mainnet: `NetXdQprcVkpaWU`. Ghostnet: `NetXnHfVqm9iesp`. |
| 3 | `oracle_address` | `address` | Exact destination KT1. Default entrypoint only. Implicit (`tz1`/`tz2`/`tz3`/`tz4`) addresses are rejected. |
| 4 | `config_version` | `nat` | ≥ 1. Must equal the active on-chain configuration version. |
| 5 | `policy_hash` | `bytes` | Exactly 32 bytes. BLAKE2B-256 of the canonical parameter-register snapshot ([PARAMETER_SCHEMA.md](PARAMETER_SCHEMA.md)). |
| 6 | `publication_group` | `string` | Exactly one of `CORE`, `USDTZ`, `TZBTC`. |
| 7 | `round` | `nat` | ≥ 1. Strictly greater than the last accepted round for this `publication_group`. Skips after an outage are allowed; reuse and reordering are not. |
| 8 | `valid_from` | `timestamp` | Unix seconds. Inclusive start of the submission window. |
| 9 | `valid_until` | `timestamp` | Unix seconds. Inclusive end. Must satisfy `valid_from < valid_until`. |
| 10 | `evidence_digest` | `bytes` | Exactly 32 bytes. BLAKE2B-256 of the quorum-shared evidence manifest. |
| 11 | `assets` | `list` | Exact set for the group, lexicographic by `asset_id`, no duplicates. |

### Asset entry

| Order | Field | Michelson | Constraints |
| ---: | --- | --- | --- |
| 1 | `asset_id` | `string` | Canonical ID from the register. ASCII `[A-Z0-9_]+`. |
| 2 | `price` | `nat` | ≥ 1. Integer fixed-point in `decimals`. Must be ≤ `price_nat_max` (2^96 − 1). |
| 3 | `decimals` | `nat` | Exact register value for that asset. Initial USD prices use 6. 0 ≤ decimals ≤ 18. |
| 4 | `observation_time` | `timestamp` | Unix seconds. Oldest contributing venue observation for this derived price. Distinct from Tezos inclusion time. |

JavaScript `number`, `NaN`, `Infinity`, scientific notation, and floating-point values MUST NOT enter canonical price or timestamp fields.

## 3. Canonical asset identifiers and groups

| `asset_id` | Group | Initial posture |
| --- | --- | --- |
| `BTC_USD` | `CORE` | draft/testnet, non-authoritative |
| `USDT_USD` | `CORE` | draft/testnet, non-authoritative |
| `XTZ_USD` | `CORE` | draft/testnet, non-authoritative |
| `USDTZ_USD` | `USDTZ` | non-authoritative stub |
| `TZBTC_USD` | `TZBTC` | non-authoritative stub |

Exact signed asset lists, lexicographic:

| Group | Ordered `asset_id` list |
| --- | --- |
| `CORE` | `BTC_USD`, `USDT_USD`, `XTZ_USD` |
| `USDTZ` | `USDTZ_USD` |
| `TZBTC` | `TZBTC_USD` |

A batch updates exactly one group. Missing, extra, duplicate, reordered, aliased, or unknown IDs are rejected. Compatibility aliases such as `XTZUSDT` are TezFin consumer mappings and MUST NOT appear in this payload.

Lexicographic order is UTF-8 code-unit order (equivalent to ASCII for these IDs), not a locale collation. Implementations MUST NOT call a locale-aware sort. For the full register ID set this means `USDTZ_USD` precedes `USDT_USD` because `Z` < `_`. The `CORE` list is unaffected.

## 4. Integer widths, timestamps, and hashes

- Michelson `nat` is unbounded; this protocol caps `price` at 2^96 − 1 and `decimals` at 18.
- `config_version` and `round` are unbounded `nat` values in practice below 2^32; implementations MAY reject values ≥ 2^64.
- `timestamp` is Tezos timestamp: signed seconds since Unix epoch. Values MUST be ≥ 1. Milliseconds, ISO-8601 strings, and floating seconds are not the packed form.
- `policy_hash` and `evidence_digest` are raw 32-byte BLAKE2B-256 digests, not hex strings, not Base58.
- `chain_id` is the 4-byte Tezos chain identifier packed as Michelson `chain_id`.

## 5. Domain separation and rejection rules

The contract and every signer MUST reject a payload, without storage change and without signature, when any of the following hold:

| Code | Condition |
| --- | --- |
| `DOMAIN` | `domain` ≠ `TEZORACLE_V1` |
| `CHAIN` | `chain_id` ≠ the executing / configured network |
| `ORACLE` | `oracle_address` ≠ `SELF` / configured destination |
| `CONFIG` | `config_version` is 0 or not the active version |
| `POLICY` | `policy_hash` length ≠ 32 or hash is not the active approved hash |
| `GROUP` | `publication_group` is not an approved group string |
| `ROUND` | `round` = 0 or `round` ≤ last accepted round for that group |
| `WINDOW` | `valid_from` ≥ `valid_until`, or chain/`now` is outside `[valid_from, valid_until]` |
| `EVIDENCE` | `evidence_digest` length ≠ 32 |
| `ASSETS_SET` | asset list is not exactly the group’s ordered set |
| `ASSET_ID` | unknown, aliased, empty, or non-canonical `asset_id` |
| `DECIMALS` | `decimals` ≠ register value for that asset |
| `PRICE` | `price` = 0 or `price` > `price_nat_max` |
| `OBS_ZERO` | `observation_time` < 1 |
| `OBS_FUTURE` | `observation_time` > `now` + `max_clock_skew_seconds` |
| `OBS_STALE` | `now` − `observation_time` > asset `max_observation_age_seconds` |
| `OBS_REGRESS` | `observation_time` < last accepted observation time for that asset |
| `PACK` | value cannot be formed under this type (wrong shape, extra fields) |

Unknown fields in any logical encoding used to *build* the payload are rejected. They are never ignored (INV-004).

Changing any signed field changes the packed bytes and invalidates every signature over the original payload.

## 6. PACK and canonical serialization

1. Construct a value of the exact type in §1. No isomorphic rewrite (no flattened tuple of a different arity, no map of assets, no optional fields).
2. `payload_bytes = PACK(payload)` using Tezos optimized binary encoding, including the `0x05` tag.
3. Each signer signs `payload_bytes`. The contract verifies with `CHECK_SIGNATURE` over those same bytes.
4. `payload_hash = BLAKE2B-256(payload_bytes)` is a log/evidence key only. It is not a substitute for signatures.

Implementations MUST NOT:

- silently sort, deduplicate, or fill the asset list
- trim, case-fold, or Unicode-normalize strings
- parse a number and reprint it
- convert timestamps to milliseconds or RFC3339 for packing
- drop unknown input fields
- substitute receipt time for `observation_time`
- pack JSON, protobuf, or Micheline *readable* encoding as the signed form

Micheline is an intermediate representation for tests. The signed object is `PACK` bytes.

## 7. Time semantics in the payload

- `observation_time` is the oldest contributing **venue** observation used to derive that asset’s `price`. See [OBSERVER_AGREEMENT.md](OBSERVER_AGREEMENT.md).
- `valid_from` / `valid_until` bound **submission**, not market freshness. A fresh inclusion of a stale observation remains stale.
- Republishing the same economic value in a new round does not refresh `observation_time` unless new observations were actually obtained.
- The public oracle view returns this `observation_time`, not inclusion time.

## 8. Golden vectors and later work

Frozen review artifacts live in `tests/packing/vectors/` (logical payload, Micheline, packed hex, BLAKE2B-256) and test-only signatures in `tests/packing/keys/`. TypeScript (`src/packing`) and SmartPy (`src/contract/packing.py`) MUST match those bytes. Signing product code stays out of this workstream; the stored signatures only prove `CHECK_SIGNATURE` over `PACK` bytes.

Contract storage, signer-set encoding, and the `submit` envelope belong to `CONTRACT_SPEC`.

Rust Class B packing is later work and must consume the same vectors.
