# Packed governance intents

**Status:** TezOracle signed `propose_*` / `cancel_*` consume these packed bytes. `activate_*` remains permissionless after delay.

**Source of PACK:** SmartPy `sp.pack` via `Packer` in `src/contract/oracle.py`.

**Golden vectors:** `tests/packing/governance/`. Do not hand-edit `packed_hex`.

Signers MUST `PACK` a locally rebuilt intent and sign **those** bytes. A CI artifact is only for comparison and refusal. `sign(artifact.packed_hex)` is forbidden.

`intent_hash` is a review name for `BLAKE2B-256(PACK(intent))`. It MUST NOT appear in the contract parameter or storage.

## 1. `t_init` ABI

`t_init` has an explicit `.layout(...)` that pins the compiled `%propose_config` comb. Field order is SmartPy’s previous default: **alphabetical by annotation**, not declaration order in `oracle.py`.

```
pair (nat %activation_delay_levels)
     (pair (address %admin)
           (pair (map %assets string <t_asset_policy>)
                 (pair (map %class_minima string nat)
                       (pair (nat %config_version)
                             (pair (map %groups string (list string))
                                   (pair (address %guardian)
                                         (pair (nat %max_clock_skew_seconds)
                                               (pair (nat %min_activation_delay_levels)
                                                     (pair (bytes %policy_hash)
                                                           (pair (nat %price_nat_max)
                                                                 (pair (map %signers nat <t_signer>)
                                                                       (pair (nat %threshold_m)
                                                                             (pair (nat %threshold_n)
                                                                                   (nat %validity_window_seconds))))))))))))))
```

`<t_asset_policy>` and `<t_signer>` keep their existing explicit layouts (declaration order, not alphabet):

```
t_asset_policy = (decimals, (max_observation_age_seconds, (absolute_min_price, (absolute_max_price, max_movement_bps))))
t_signer       = (public_key, (class_id, active))
```

Maps are Michelson maps: keys are sorted by the packed key order. Insertion order in an implementation MUST NOT change `PACK` bytes.

`policy_hash` is BLAKE2B-256 of the parameter register only. Signer keys, `N`/`M`, `admin`, and `guardian` are covered only because they sit inside this packed `init`.

`class_id` is a non-empty Michelson string. There is no ASCII-only restriction; UTF-8 labels are valid and have a golden vector.

## 2. Domain constants

Each entrypoint has its own domain. A signature over one MUST fail `CHECK_SIGNATURE` on another.

| Domain | Packed body after the common prefix |
| --- | --- |
| `TEZORACLE_CONFIG_V1` | `init` (`t_init`) |
| `TEZORACLE_CONFIG_CANCEL_V1` | (none) |
| `TEZORACLE_UNPAUSE_V1` | (none) |
| `TEZORACLE_UNPAUSE_CANCEL_V1` | (none) |
| `TEZORACLE_ASSET_UNPAUSE_V1` | `asset_id` |
| `TEZORACLE_ASSET_UNPAUSE_CANCEL_V1` | `asset_id` |

Price payloads remain `TEZORACLE_V1` and MUST be rejected as governance.

## 3. Common prefix (explicit layout, declaration order)

All governance intents start with this right-comb:

```
pair (string %domain)
     (pair (chain_id %chain_id)
           (pair (address %oracle_address)
                 (pair (nat %current_config_version)
                       (pair (nat %governance_nonce)
                             (timestamp %valid_until)))))
```

Then:

- config propose appends `init`
- asset intents append `asset_id` (inside the packed bytes, not only the Michelson call parameter)

`asset_id` in `TEZORACLE_ASSET_UNPAUSE_V1` vs another id MUST change the packed bytes.

## 4. Replay: nonce and expiry

Intents include `governance_nonce` and `valid_until`. The contract requires `nonce == storage.governance_nonce` and `now <= valid_until`, then increments the nonce on successful signed `propose_*` / `cancel_*`. Cancel does not bump `config_version`; the nonce is what makes cancel final.

## 5. Implementations

| Path | Role |
| --- | --- |
| `src/contract/oracle.py` `Packer` | Normative `sp.pack` |
| `src/contract/governance_pack.py` | Logical JSON → SmartPy records → PACK |
| `src/packing/governance_*.ts` | Independent TS PACK; must match vectors |
| `tests/packing/governance/GI-*.json` | Frozen `packed_hex` / `blake2b_hex` from SmartPy |

Regenerate vectors with `PYTHONPATH=src python scripts/freeze-governance-vectors.py`. Then run Python and TypeScript packing tests. Do not invent hex by reading field order out of `oracle.py` without packing.

Lost-key recovery for 4-of-4 is **not** an on-chain escape hatch: originate a new oracle and retarget the consumer. That decision is independent of this packing freeze.

## 6. Signer-local config source

For `TEZORACLE_CONFIG_V1`, the signer does not trust `intent.init`. It rebuilds
`init` from the local parameter register and a signer-local sidecar:

```json
{
  "schema_version": 1,
  "admin": "tz1...",
  "guardian": "tz1...",
  "threshold_n": "3",
  "threshold_m": "4",
  "signers": {
    "0": { "public_key": "edpk...", "class_id": "A", "active": true }
  },
  "class_minima": { "A": "1", "B": "1" }
}
```

The register supplies config version, policy hash, groups, asset policies,
timing, and `price_nat_max`. The sidecar supplies addresses and committee
configuration. The live sidecar is versioned in git as
`config/governance/v<config_version>/sidecar.json` and is reviewed with the
register bump. `config/governance/intent.example.json` is the per-action
envelope template; live `intent.json` stays gitignored. The artifact supplies
only the
operation envelope (`chain_id`, oracle, current version, nonce, expiry) and
comparison `packed_hex`. Any difference between artifact bytes and the
locally rebuilt `PACK` is `CANDIDATE_MISMATCH`.

## 7. Manual signing and collection

Each signer domain runs its own signing command after independently pinning
the same register, sidecar, and artifact:

```bash
npm run validator -- sign-governance \
  --intent approved-intent.json \
  --sidecar governance-sidecar.json
```

A keyless collector builds the on-chain call:

```bash
npm run governance -- open \
  --intent approved-intent.json \
  --signers current-signers.json \
  --state collection.json \
  --collect-until 1800000300

npm run governance -- collect \
  --state collection.json \
  --signature signer-a1.json

npm run governance -- assemble \
  --state collection.json \
  --output call.json
```

Unlike price collection, governance collection ignores price `threshold_n`
and reaches quorum only after signatures from all `threshold_m` active keys.
The assembled call contains the intent and `(index, signature)` entries.
