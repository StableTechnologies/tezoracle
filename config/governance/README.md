# Governance signer deployment inputs

Committee configuration is versioned in git. The per-action envelope is not.

## Sidecar (config-version pin)

`config/governance/v<config_version>/sidecar.json` is reviewed in the same
PR that changes `config/register.json` `config_version`. It contains only
public data: `admin`, `guardian`, signer `edpk`s, N/M, `class_minima`.

The handler loads the sidecar for the **pinned register version**, not a
mutable path. Adding a fifth signer means committing
`config/governance/v4/sidecar.json` next to `config_version: 4`.
The file itself is the schema; there is no separate example copy.

## Intent (per-action)

`intent.json` and `manifest.json` stay gitignored. They bind `governance_nonce`
and `valid_until` to one propose/cancel. After `activate_config`, regenerate
them with the new `current_config_version` and nonce, freeze, and redeploy
before the next governance signature.

```bash
cp config/governance/intent.example.json config/governance/intent.json
# edit envelope: chain_id, oracle, nonce, expiry; rebuild packed_hex
npm run governance:freeze-deployment
```

`manifest.json` is not written by hand. Freeze hashes the exact bytes of
`intent.json`. The Lambda compares that digest before parsing.

For `TEZORACLE_CONFIG_V1` the signer rebuilds `init` from the local register
plus `v<config_version>/sidecar.json`. `intent.init` is review-only.

`npm run governance:check-sidecar` verifies the committed sidecar for the
current register version without requiring `intent.json`.

## Rotation flow (4-of-4 → 5-of-5)

On-chain now: `config_version = 3`, four active keys. Target: fifth `edpk`,
`threshold_m = 5`, `config_version = 4`.

### 1. Publish the new public key

The fifth operator generates `edsk`/`edpk` locally. That key does **not**
sign the transition. The current four only embed the `edpk` in the new
sidecar.

### 2. One git PR — the new pin

| File | Role |
| --- | --- |
| `config/register.json` | `config_version: 3 → 4`. This changes `policy_hash` even if assets are untouched. |
| `config/assets/*` | Only if price policy changes in the same proposal. |
| `config/governance/v4/sidecar.json` | Five `edpk`s, `threshold_m: "5"`, N and `class_minima` as reviewed. |
| `config/governance/v3/sidecar.json` | Leave it. Price signers still run on this pin until activation. |

### 3. Two deployments until activation

Do not point live price Lambdas at v4 yet. `submit` carries `config_version`
from the register; storage is still 3.

| Process | Pin | Files |
| --- | --- | --- |
| Prices (`signerClassA`, tick) | **v3** | register with version 3, `v3/sidecar.json`. No intent. |
| Governance (`signerGovernance`) | **v4** | register with version 4, `v4/sidecar.json`, plus a fresh intent. |

Each of the four current domains checks out the PR and packages its own
governance Lambda from that commit.

### 4. Per-action envelope (not in git)

| File | Role |
| --- | --- |
| `config/governance/intent.json` | `domain: TEZORACLE_CONFIG_V1`, `current_config_version: "3"` (on-chain now), live `governance_nonce`, `valid_until`, `chain_id`, oracle. Rebuild `packed_hex` locally. |
| `config/governance/manifest.json` | SHA-256 of those intent bytes. Produced by freeze. |

Freeze loads the sidecar from `v${register.config_version}/` — on this
checkout that is **v4**. The envelope tells the contract it is replacing
the config that is still version 3.

```bash
npm run governance:freeze-deployment
```

Mismatch between local `PACK(register v4 + sidecar v4)` and
`artifact.packed_hex` is `CANDIDATE_MISMATCH`; the key is not used.

### 5. Sign and collect

On each of the four domains, invoke only:

```text
signerGovernance  { "action": "config", "index": "<old map index>" }
```

The Lambda reads `intent.json` (digest vs `manifest.json`), rebuilds
`init` from register v4 + `v4/sidecar.json`, packs, compares, and signs
its own bytes with the current `edsk` (one of the old four).

A keyless collector assembles the call:

```bash
npm run governance -- open \
  --intent config/governance/intent.json \
  --signers current-four.json \
  --state collection.json \
  --collect-until <unix>

npm run governance -- collect --state collection.json --signature signer-N.json
# repeat for each of the four

npm run governance -- assemble --state collection.json --output call.json
```

Quorum is M-of-M of **current** storage, so 4. A fifth signature is
`UNKNOWN_SIGNER`.

### 6. On-chain

1. `propose_config(intent, signatures)` — `CHECK_SIGNATURE` against the
   **old** four keys; `init.config_version == 3 + 1`; nonce increments;
   pending is set.
2. Wait `activation_delay_levels`.
3. Anyone: `activate_config`. Storage becomes the signed `init`: five
   keys, version 4, new `policy_hash`. Committee is not equivalent, so
   `active` quotes and `last_round` clear. `get_price` returns `NO_PRICE`
   until a new `submit` matures.

To abort before activation, collect a `TEZORACLE_CONFIG_CANCEL_V1` intent
with the same old four keys. Cancel does not apply sidecar v4.

### 7. Immediately after activation

| Who | What |
| --- | --- |
| All **five** price domains | Deploy pin v4 (register 4 + `v4/sidecar.json`). Otherwise `CONFIG` / `POLICY`. |
| Tick / `submit` | Payload with `config_version: "4"` and the new `policy_hash`. After delay, prices are visible again. |
| Governance Lambda | Rebuild `intent.json` with `current_config_version: "4"`, the new on-chain nonce, a new `valid_until`; freeze; redeploy. |
| `v3/sidecar.json` in git | Historical. It cannot produce a valid new signature (nonce, version, PACK). |

The next committee change is a new PR with `v5/sidecar.json` and
`config_version: 5`, then this flow again with **5-of-5** on the sign of
that proposal.
