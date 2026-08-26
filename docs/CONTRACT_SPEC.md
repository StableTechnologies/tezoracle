# N-of-M oracle contract

**Status:** testnet and non-authoritative shadow only.  
**Source:** `src/contract/oracle.py`  
**Artifact:** `michelson/tezoracle.tz`  
**Harness:** `tests/contract/`

One compiled Michelson contract is parameterized by signer set, threshold `N`, set size `M`, and per-class minima. It is **not** a disposable `SimplePriceOracle` and does **not** hard-code 3-of-4. 1-of-1 is permitted only for testnet and non-authoritative shadow.

This contract does **not** implement TezFin aliases, `configureMaxPriceAge`, `configurePriceBounds`, or `set_oracle`. The public price surface is mature `(nat price, timestamp observation_time)` using the market observation time from the frozen payload, not Tezos inclusion time. Consumer freshness and bounds stay in TezFin ([ARCHITECTURE.md](ARCHITECTURE.md), [ORACLE_INTERFACE.md](ORACLE_INTERFACE.md)).

## 1. Roles

| Role | May | Must not |
| --- | --- | --- |
| Anyone (relayer) | `submit` a fully signed payload; activate a matured timelock | Hold signer keys; change signed bytes |
| Admin | Immediate pause; propose delayed unpause and delayed config | Instantly unpause, lower `N`, replace signers, or change policy |
| Guardian | Immediate global or per-asset pause | Unpause, propose config, or change thresholds |
| Signers | Off-chain: sign `PACK(payload)` | On-chain authority beyond `CHECK_SIGNATURE` |

Admin and guardian may be the same address in 1-of-1 testnet.

## 2. Storage

| Field | Meaning |
| --- | --- |
| `admin` / `guardian` | Governance and emergency pause |
| `paused` | Global pause; blocks `submit` and price views |
| `pending_unpause_level` | If `Some(L)`, global unpause may activate at level `L` |
| `config_version` | Active configuration version; payloads must match |
| `policy_hash` | 32-byte BLAKE2B of the pinned parameter register |
| `threshold_n` / `threshold_m` | Quorum `N` of active set size `M` |
| `activation_delay_levels` | Non-zero. Pending prices and timelocks mature at `accept_level + delay` |
| `min_activation_delay_levels` | Floor for delay; always ≥ 1 |
| `max_clock_skew_seconds` | Future observation tolerance |
| `validity_window_seconds` | Cap on `valid_until - valid_from` |
| `price_nat_max` | Inclusive price cap (register `2^96 - 1`) |
| `signers` | `map nat → {public_key, class_id, active}` |
| `class_minima` | `map class_id → nat` (0 or omitted = no class floor) |
| `groups` | `map group → list asset_id` in exact signed order |
| `assets` | Per-asset policy and pending/active quotes |
| `last_round` | Last **accepted** round per publication group |
| `pending_config` | Delayed replacement of governable parameters |

### 2.1 Signer set

- Indices are unique `nat` keys. They need not be contiguous.
- `threshold_m` equals the number of **active** signers.
- `1 ≤ N ≤ M ≤ 16`. Sixteen is the reviewed maximum for this phase (`5-of-7` fits).
- Duplicate public keys are rejected.
- `class_id` is a non-empty string (`A` / `B` in production intent; any label is allowed).
- Each `class_minima[c]` MUST be ≤ the number of active signers in class `c`.
- The sum of class minima MUST be ≤ `N`.
- Class minima of **0** are allowed so 1-of-1 testnet/shadow can originate.

### 2.2 Asset state

Each asset stores:

- policy: `decimals`, `max_observation_age_seconds`, `absolute_min_price`, `absolute_max_price`, `max_movement_bps`
- `paused` and optional `pending_unpause_level`
- `last_observation_time` (zero until the first accepted batch that includes the asset)
- `active`: last mature quote, or none
- `pending`: newly accepted quote, or none

A quote stores `price`, `observation_time`, `round`, `config_version`, and `accepted_level`. Pending quotes also store `activation_level = accepted_level + activation_delay_levels`.

Register absolute bounds are oracle-level fail-closed checks. They are not TezFin `configurePriceBounds`.

## 3. Payload and `submit`

`submit` is permissionless. The parameter is:

```
pair (payload %payload) (list %signatures (pair (nat %index) (signature %signature)))
```

`payload` is exactly the frozen type in [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md): domain, chain_id, oracle_address, config_version, policy_hash, publication_group, round, valid_from, valid_until, evidence_digest, and the ordered asset list `(asset_id, price, decimals, observation_time)`.

The contract:

1. Rejects global pause.
2. Promotes any matured pending prices (see §5).
3. Checks payload fields against storage and `now` / `SELF` / `CHAIN_ID` (table below).
4. `PACK`s the payload with the frozen layout and verifies every submitted signature with `CHECK_SIGNATURE` over those bytes.
5. Enforces unique indices, known active signers, `N`, and class minima.
6. Writes a **pending** quote per asset. It does not make the batch consumable in the accept level.
7. Updates `last_round[group]` and each asset’s `last_observation_time`.

A failed `submit` changes no price, round, or activation state.

### 3.1 Rejection codes

Payload codes match [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md) §5. Contract-only codes are listed after them.

| Code | Condition |
| --- | --- |
| `DOMAIN` | `domain` ≠ `TEZORACLE_V1` |
| `CHAIN` | `chain_id` ≠ executing chain |
| `ORACLE` | `oracle_address` ≠ `SELF` |
| `CONFIG` | `config_version` is 0 or not the active version |
| `POLICY` | `policy_hash` length ≠ 32 or hash ≠ active hash |
| `GROUP` | `publication_group` is not a configured group |
| `ROUND` | `round` = 0 or `round` ≤ last accepted round for that group |
| `WINDOW` | `valid_from ≥ valid_until`, `now` outside `[valid_from, valid_until]`, or window longer than `validity_window_seconds` |
| `EVIDENCE` | `evidence_digest` length ≠ 32 |
| `ASSETS_SET` | asset ids are not exactly the group’s ordered list |
| `ASSET_ID` | asset missing from storage |
| `DECIMALS` | `decimals` ≠ configured value |
| `PRICE` | `price` = 0 or `price` > `price_nat_max` |
| `BOUNDS` | `price` outside the asset’s absolute min/max |
| `OBS_ZERO` | `observation_time` < 1 |
| `OBS_FUTURE` | `observation_time` > `now + max_clock_skew_seconds` |
| `OBS_STALE` | `now − observation_time` > asset `max_observation_age_seconds` |
| `OBS_REGRESS` | `observation_time` < last accepted observation time for that asset |
| `PAUSED` | global pause |
| `ASSET_PAUSED` | an asset in the batch is paused |
| `QUORUM` | fewer than `N` unique valid signatures, or more than 16 signatures |
| `DUPLICATE` | repeated signer index |
| `UNKNOWN_SIGNER` | index not in the active configuration |
| `INACTIVE_SIGNER` | signer exists but `active = false` |
| `SIGNATURE` | `CHECK_SIGNATURE` failed |
| `CLASS_MIN` | a configured class minimum was not met |
| `NOT_ADMIN` | caller is not admin |
| `NOT_AUTHORIZED` | caller is neither admin nor guardian |
| `BAD_CONFIG` | proposed or originated quorum/policy is impossible |
| `NO_PENDING` | activate/cancel with nothing pending |
| `NOT_PAUSED` | unpause proposed while not paused |
| `DELAY` | timelock has not reached `activate_at_level` |
| `NO_PRICE` | view: no mature, unpaused quote |

Unknown, duplicate, and inactive signers never count toward `N` or class minima. A bad signature fails the operation; it is not skipped.

Skipping rounds after an outage is allowed. Reusing or reordering an accepted round is not.

## 4. Views

| View | Parameter | Result |
| --- | --- | --- |
| `get_price` | `string` asset id | `pair (nat %price) (timestamp %observation_time)` |
| `get_price_with_timestamp` | same | same pair (TezFin-facing name) |

Both views:

- Fail `PAUSED` / `ASSET_PAUSED` / `ASSET_ID` / `NO_PRICE` rather than returning zero.
- Return only a **mature** quote: `now_level ≥ pending.activation_level`, or the stored `active` quote if no mature pending exists.
- Use payload `observation_time`, never the inclusion timestamp.
- If a mature pending quote exceeds `max_movement_bps` versus the current active price, they do **not** return the pending value. They return the previous active quote (original observation time). The next mutating entrypoint pauses the asset and drops that pending quote.

Views are read-only: they do not write promotion. Entrypoints persist promotion first.

This contract does not expose `configureMaxPriceAge` or `configurePriceBounds`.

## 5. Pending versus active

`activation_delay_levels ≥ min_activation_delay_levels ≥ 1`. Governance cannot set the delay to 0.

On accept at level `L`, each asset in the batch gets a pending quote with `activation_level = L + activation_delay_levels`. The public view must not consume that quote at level `L`.

On any mutating entrypoint, for each asset with a mature pending quote:

- If there is no active quote, pending becomes active.
- If `|new − old| * 10000 ≤ max_movement_bps * old`, pending becomes active.
- Otherwise the asset is paused, pending is dropped, and the previous active quote is kept with its original observation time.

## 6. Pause and delayed resume

- `pause` and `pause_asset` take effect immediately (admin or guardian). Global pause clears a pending global unpause.
- `propose_unpause` / `propose_asset_unpause` are admin-only and set `pending_unpause_level = now_level + activation_delay_levels`.
- `activate_unpause` / `activate_asset_unpause` are permissionless after that level.
- Admin may `cancel_pending_unpause` or `cancel_asset_unpause`.

Paused assets reject `submit` for any batch that includes them. Views fail closed.

## 7. Delayed governance

`propose_config` (admin) stores a full replacement of:

admin, guardian, `config_version` (must be current `+ 1`), `policy_hash`, `N`, `M`, class minima, signer set, groups, asset policies, activation delay, skew, validity window, and `price_nat_max`.

Activation uses the **current** delay so a proposal that shortens delay cannot apply itself sooner. `activate_config` is permissionless after `activate_at_level`. `cancel_pending_config` is admin-only.

On activation:

- Price/round state is kept for asset ids that remain.
- New assets start with no quote.
- Removed assets disappear (views fail `ASSET_ID`).
- Signatures from the previous signer set / `config_version` become invalid.

Not in this contract: TezFin `set_oracle`, aliases, source-adapter lists (those live in the register and are bound only as `policy_hash`).

## 8. Configurations (same artifact)

| Config | Typical use | Class minima |
| --- | --- | --- |
| 1-of-1 | testnet / shadow only | `0` |
| 3-of-4 | intended production shape as a **config**, not compiled-in | e.g. `A: 1`, `B: 1` |
| 4-of-5, 5-of-7 | unit configs in the harness | may be `0` |

Impossible configs (`N = 0`, `N > M`, `M` ≠ active count, minima that no class can meet, delay 0) fail `BAD_CONFIG` at origination and at `propose_config`.

## 9. Compilation and testnet

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest tests/contract
python -m contract.compile
```

`python scripts/compile_oracle.py` (or `PYTHONPATH=src python -m contract.compile`) writes `michelson/tezoracle.tz` from the SmartPy compiler after stripping stack-annotation comments (semantics unchanged). Initial compile in this phase: **no compiler errors**, about **86 KiB** of Michelson, one `CHECK_SIGNATURE`. Full 5-of-7 operation gas/size benches against a live RPC remain stretch; the harness originates 1-of-1, 3-of-4, 4-of-5, and 5-of-7 as unit configs.

Testnet origination: [TESTNET_DEPLOY.md](TESTNET_DEPLOY.md). Use only testnet keys from runtime config. Do not originate with production keys.

## 10. Events

| Tag | When |
| --- | --- |
| `tezoracle_submit` | Accepted batch (`group`, `round`, `config_version`) |
| `tezoracle_pause` | Global or per-asset pause |
| `tezoracle_config` | Config proposal, cancel, or activation |
