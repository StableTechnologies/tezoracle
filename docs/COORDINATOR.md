# Coordinator

**Status:** implemented for the initial TezOracle phase.  
**Authority:** testnet and non-authoritative shadow only.  
**Keys:** none. The coordinator is not a signer.

The coordinator may trigger a round and may assemble a candidate for validators to consider. It does **not** choose the authoritative price. It does **not** supply or override policy. Validators independently derive or verify under the pinned register ([OBSERVER_AGREEMENT.md](OBSERVER_AGREEMENT.md)). Absence of this process must not block publication of an independently assembled, correctly signed batch through a permissionless relayer.

## 1. Boundaries

| May do | Must not do |
| --- | --- |
| Trigger a per-group round when the previous window has ended or the previous round is confirmed | Hold an oracle signing key, mnemonic, or `edsk` |
| Derive a candidate under the locally pinned `config/` register | Accept sources, minima, deviation, aggregation, decimals, age, or a price override from a request |
| Present the same `{ payload, evidence }` document Class A already knows | Require a validator to sign a mismatched candidate |
| Collect signatures over frozen `PACK(payload)` bytes | Re-sign, reorder payload fields, or replace `packed_hex` |
| Seal a portable signed batch once `N` (and class minima) are met | Publish on incomplete quorum or after `collect_until` |
| Hand the sealed batch to any relayer | Treat coordinator downtime as a halt on independent relay |

Policy values come only from the pinned parameter register. A round request carries domain-separation fields (`chain_id`, `oracle_address`, `config_version`, `policy_hash`) copied from that register and from runtime configuration. Unknown request fields that look like policy are refused (`POLICY_PIN`).

USDtz and tzBTC groups are draft stubs. The coordinator refuses to assemble those candidates (`STUB_GROUP`) until a separately reviewed DEX policy exists.

## 2. Round trigger

`triggerRound` writes a `TEZORACLE_ROUND_V1` request:

| Field | Source |
| --- | --- |
| `publication_group` | Caller (`CORE` in this phase) |
| `round` | Caller; contract and signers enforce monotonicity |
| `config_version`, `policy_hash` | Pinned `config/` snapshot |
| `valid_from` / `valid_until` | Local `now` and register `validity_window_seconds` |
| `collect_until` | `now + collect_timeout_seconds` (default: the validity window) |
| `chain_id`, `oracle_address` | Runtime / flags — not policy |

Validators may refuse a trigger. Skipping a coordinator-proposed round is allowed. Reusing an accepted on-chain round is not.

## 3. Candidate assembly

A candidate is exactly `{ payload, evidence }` as in [CLASS_A_VALIDATOR.md](CLASS_A_VALIDATOR.md). The coordinator produces it by calling Class A `derivePublicationGroup` and `candidateFromDerivation` under the same pinned snapshot the validators use.

It does not invent a price. It does not accept a caller-supplied payload, evidence digest, or source list. If derivation fails, the round fails closed. There is no “publish anyway” path.

Validators still independently retrieve observations and refuse to sign on mismatch. The coordinator’s candidate is a convenience, not an authority.

## 4. Signature collection

`openCollection` freezes `packed_hex = PACK(payload)`. Every later signature must cover those exact bytes.

The coordinator:

1. Rejects a signature whose `packed_hex` differs (`PACKED_MISMATCH`).
2. Rejects unknown, inactive, and duplicate signer indices.
3. Verifies `CHECK_SIGNATURE` locally over the frozen bytes.
4. Counts unique valid signatures toward `N` and class minima.
5. After `collect_until`, refuses new signatures and seals as `TIMEOUT` if quorum is unmet.

`N`, `M`, and class minima are the on-chain signer-set configuration, not market-data policy. `1-of-1` is testnet/shadow only. `3-of-4` is a configuration, not hard-coded coordinator logic.

A sealed batch is a `TEZORACLE_SIGNED_BATCH_V1` document: payload, `packed_hex`, and `(index, public_key, signature)` entries. Evidence is not submitted on-chain. The batch is portable: any relayer can verify and submit it without talking to this process.

## 5. Publication tick

`src/runtime/tick.ts` is the shared tick. It composes this coordinator, an injected Class A `sign`, and the permissionless relayer. It does not invent policy.

```text
observe/derive → candidate → 1-of-1 sign → collect/assemble → verify → simulate/submit → read view
```

Cadence is **300 seconds**. `validity_window_seconds` stays **180** (the submit window). The tick must finish or fail closed inside that window. If a previous pending quote is still immature (`PENDING_OPEN`), the tick skips and does not weaken the activation delay.

Local driver: `runTickLoop` / `startTickInterval` with an injected clock. AWS driver: EventBridge `rate(5 minutes)` on `coordinatorTick`. The tick process is a coordinator and holds no oracle keys.

Local 1-of-1 e2e lives in `tests/e2e/local.test.ts` (mock CEX fixtures + in-memory contract harness). Live Shadownet origination remains stretch.

## 6. CLI

```bash
npm run coordinator -- trigger   --group CORE [--round n] [--now unix] [--config dir]
npm run coordinator -- candidate --group CORE [--round n] [--fixtures file] [--now unix] [--state file] [--signers file]
npm run coordinator -- collect   --state file --signature file [--index n] [--now unix]
npm run coordinator -- assemble  --state file [--now unix] [--close]
```

| Flag / env | Role |
| --- | --- |
| `--config` | Parameter-register directory. Default `./config`. |
| `--fixtures` | Deterministic HTTP map (CI / local). Omit to use live HTTPS. |
| `--now` | Unix-seconds clock override for tests. |
| `--signers` | On-chain signer-set JSON (`N`, `M`, class minima, public keys). |
| `--state` | Collection JSON (public signatures only). |
| `--close` | Mark an open collection incomplete before `assemble`. |
| `TEZOS_CHAIN_ID` / `ORACLE_ADDRESS` | Domain-separation fields for the payload. |

The coordinator never reads `TEZORACLE_SIGNER_SECRET_KEY`.

AWS testnet/shadow transport (coordinator Lambdas cannot `GetSecretValue` on the Class A signer secret): [AWS_DEPLOY.md](AWS_DEPLOY.md).

`--fixtures` is the supported CI path.

## 7. Failure codes

| Code | Meaning |
| --- | --- |
| `POLICY_PIN` | Request carried policy-shaped fields, or hash/version is not the pinned register |
| `STUB_GROUP` | `USDTZ` / `TZBTC` candidate assembly |
| `PACKED_MISMATCH` | Signature or payload does not match the frozen candidate bytes |
| `SIGNATURE` | Local `CHECK_SIGNATURE` failed, or public key does not match the set |
| `UNKNOWN_SIGNER` / `INACTIVE_SIGNER` / `DUPLICATE` | Signer-set checks |
| `QUORUM` | Collection still open and below `N` |
| `TIMEOUT` | `collect_until` passed without quorum |
| `INCOMPLETE` | Collection closed without quorum |
| `CLASS_MIN` | A configured class minimum was not met |
| `HOLD_KEYS` | Secret-shaped material appeared in coordinator state |
| `INTERNAL` | Malformed input or unknown command |

## 8. Out of scope

- Production keys, endpoints, or TezFin `set_oracle`
- Rust Class B and A1/A2/B1/B2 isolation
- Choosing a production 3-of-4 as the only supported configuration
- Treating the testnet 5-minute tick as production authorization
- Live Shadownet origination (stretch)
