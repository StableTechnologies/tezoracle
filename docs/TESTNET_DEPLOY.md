# Testnet origination

**Status:** non-production. 1-of-1 on **Shadownet** (or a local sandbox) only.  
Do **not** originate this contract with production keys, production RPCs, or a production signer set.

Compiled code: `michelson/tezoracle.tz` (regenerate with `PYTHONPATH=src python -m contract.compile` or `python scripts/compile_oracle.py`).

## Network

| | Value |
| --- | --- |
| Network | Shadownet |
| RPC | `https://rpc.shadownet.teztnets.com` |
| `chain_id` | `NetXsqzbfFenSTS` (packed hex `d052218e`) |
| Faucet | https://faucet.shadownet.teztnets.com/ |

`chain_id` is not stored on the contract. `submit` checks it against `CHAIN_ID`. Signed payloads for this deployment MUST use `NetXsqzbfFenSTS`, not a leftover Ghostnet id.

## Prerequisites

- `octez-client` (or another Tezos client) pointed at **Shadownet** or a local mockup
- A testnet-only `tz1`/`tz2`/`tz3` secret in `.env` as `TEZORACLE_SIGNER_SECRET_KEY` (see `.env.example`)
- Funded Shadownet account for origination fees
- Initial storage matching the intended **configuration** (1-of-1 for this phase)

Never paste a production `edsk` into the client, CI, or this repository.

```bash
octez-client -E https://rpc.shadownet.teztnets.com config update
```

## Compile

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
PYTHONPATH=src python -m contract.compile
```

Confirm `michelson/tezoracle.tz` contains `CHECK_SIGNATURE` and that the compiler printed no errors. The dummy storage printed by the compile command uses SmartPy `test_account` keys and **must not** be originated as-is on a network with value.

Encoded origination size, gas, storage burn, and fees for dummy 3-of-4 / 5-of-7 configs are measured with a local Ushuaia mockup (`PYTHONPATH=src python scripts/measure_octez_ops.py --write`). See [OPERATION_MEASUREMENTS.md](OPERATION_MEASUREMENTS.md). That path uses well-known mockup bootstrap keys, not production keys.

## Build initial storage

Originate with the same parameters the harness uses for 1-of-1:

- `threshold_n = 1`, `threshold_m = 1`
- class minima empty or `{ "A" = 0 }`
- `activation_delay_levels ≥ 1`
- `config_version` = the committed register's `config_version` (currently `3`)
- `policy_hash` = BLAKE2B-256 of the pinned `config/` snapshot
- Admin and guardian: your testnet addresses
- Signer public key: the testnet key from `.env`, never a production key
- `groups` / `assets` = the full committed register (`CORE`, `USDTZ`, `TZBTC`), not a single asset

`scripts/build_origination_storage.py` builds this storage from the real committed `config/` register (not the dummy compile/mockup fixtures) and prints the `policy_hash` plus Micheline for `--init`:

```bash
PYTHONPATH=src python scripts/build_origination_storage.py \
  --admin tz1YOUR... \
  --signer-pk edpkYOUR...
```

`--admin` and `--signer-pk` must be your testnet-only address/key, never production. `--guardian` defaults to `--admin` if omitted.

## Example `octez-client` origination

Replace placeholders. This is Shadownet / sandbox only.

```bash
export TEZOS_RPC_URL="https://rpc.shadownet.teztnets.com"

octez-client --endpoint "${TEZOS_RPC_URL}" \
  originate contract tezoracle \
  transferring 0 from testnet-admin \
  running michelson/tezoracle.tz \
  --init "${STORAGE_MICHELSON}" \
  --burn-cap 5
```

Record the resulting `KT1…` as `ORACLE_ADDRESS` in local `.env`. Signers must put that exact address in the payload `oracle_address` field and `TEZOS_CHAIN_ID=NetXsqzbfFenSTS`.

## After origination

1. Confirm `get_price` fails `NO_PRICE` until a delayed 1-of-1 batch matures.
2. Submit only with testnet signatures over frozen `PACK(payload)` bound to Shadownet `chain_id`.
3. Do not point TezFin `set_oracle` at this address.
4. Do not reuse the testnet key on mainnet.

Live Shadownet origination is stretch for the initial phase. Local/sandbox e2e is the baseline.
