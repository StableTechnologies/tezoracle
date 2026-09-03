"""Freeze governance PACK golden vectors from SmartPy sp.pack.

Do not hand-edit packed_hex. Regenerates tests/packing/governance/GI-*.json.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import smartpy as sp

from contract.governance_pack import (
    ASSET_UNPAUSE_DOMAIN,
    CONFIG_CANCEL_DOMAIN,
    CONFIG_DOMAIN,
    UNPAUSE_DOMAIN,
    pack_asset_intent,
    pack_config_intent,
    pack_simple_intent,
)
from contract.oracle import main as oracle_main
from contract.payload import payload_digest

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/packing/governance"

ORACLE = "KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy"
CHAIN = "NetXsqzbfFenSTS"
ADMIN = "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC"
PACKING_EDPK = "edpktnrDwsBBd5M2N9TGquSrUZP28q44GnvahhD3QQNMNQmbGTDGhb"
POLICY_HASH = "11" * 32
PRICE_NAT_MAX = str((1 << 96) - 1)
VALID_UNTIL = "1800000180"

EDPK_RE = re.compile(r'Pair "(edpk[^"]+)"')


def _xtz_policy(*, decimals: str = "6") -> dict:
    return {
        "decimals": decimals,
        "max_observation_age_seconds": "120",
        "absolute_min_price": "10000",
        "absolute_max_price": "100000000",
        "max_movement_bps": "10000",
    }


def _btc_policy() -> dict:
    return {
        "decimals": "6",
        "max_observation_age_seconds": "120",
        "absolute_min_price": "1000000000",
        "absolute_max_price": "500000000000",
        "max_movement_bps": "10000",
    }


def edpks_for_seeds(seeds: list[str], indices: list[int] | None = None) -> list[str]:
    if indices is None:
        indices = list(range(len(seeds)))
    accounts = [sp.test_account(seed) for seed in seeds]
    scenario = sp.test_scenario(None, oracle_main)
    packer = oracle_main.Packer()
    scenario += packer
    signers = {
        indices[i]: sp.record(
            public_key=accounts[i].public_key, class_id="A", active=True
        )
        for i in range(len(seeds))
    }
    packer.pack_init(
        sp.record(
            admin=sp.address(ADMIN),
            guardian=sp.address(ADMIN),
            config_version=1,
            policy_hash=sp.bytes("0x" + POLICY_HASH),
            threshold_n=len(seeds),
            threshold_m=len(seeds),
            activation_delay_levels=1,
            min_activation_delay_levels=1,
            max_clock_skew_seconds=5,
            validity_window_seconds=180,
            price_nat_max=int(PRICE_NAT_MAX),
            signers=signers,
            class_minima={},
            groups={"CORE": ["XTZ_USD"]},
            assets={"XTZ_USD": sp.record(
                decimals=6,
                max_observation_age_seconds=120,
                absolute_min_price=10000,
                absolute_max_price=100000000,
                max_movement_bps=10000,
            )},
        )
    )
    body = scenario.entrypoint_calls[-1][1]
    message = body["message"] if "message" in body else body
    arg = message["arg_michelson"]
    found = EDPK_RE.findall(arg)
    if len(found) != len(seeds):
        raise RuntimeError(f"expected {len(seeds)} edpk, got {found}")
    return found


def signer_entry(edpk: str, class_id: str = "A", active: bool = True) -> dict:
    return {"public_key": edpk, "class_id": class_id, "active": active}


def base_init(*, signers: dict, threshold_n: str, threshold_m: str, **overrides) -> dict:
    init = {
        "admin": ADMIN,
        "guardian": ADMIN,
        "config_version": "2",
        "policy_hash": POLICY_HASH,
        "threshold_n": threshold_n,
        "threshold_m": threshold_m,
        "activation_delay_levels": "8",
        "min_activation_delay_levels": "1",
        "max_clock_skew_seconds": "5",
        "validity_window_seconds": "180",
        "price_nat_max": PRICE_NAT_MAX,
        "signers": signers,
        "class_minima": {},
        "groups": {"CORE": ["XTZ_USD"]},
        "assets": {"XTZ_USD": _xtz_policy()},
    }
    init.update(overrides)
    return init


def config_intent(init: dict, *, nonce: str = "0") -> dict:
    return {
        "domain": CONFIG_DOMAIN,
        "chain_id": CHAIN,
        "oracle_address": ORACLE,
        "current_config_version": "1",
        "governance_nonce": nonce,
        "valid_until": VALID_UNTIL,
        "init": init,
    }


def write_vector(path: Path, vector: dict) -> None:
    path.write_text(json.dumps(vector, ensure_ascii=False, indent=2) + "\n")


def freeze() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    four = edpks_for_seeds([f"gov-4-{i}" for i in range(4)])
    rotated = edpks_for_seeds(["gov-rotate-0"] + [f"gov-4-{i}" for i in range(1, 4)])
    sparse = edpks_for_seeds(
        ["gov-sparse-0", "gov-sparse-1", "gov-sparse-5", "gov-sparse-9"],
        indices=[0, 1, 5, 9],
    )
    sixteen = edpks_for_seeds([f"gov-16-{i:02d}" for i in range(16)])
    utf_edpk = edpks_for_seeds(["gov-utf8"])[0]

    gi01_init = base_init(
        signers={"0": signer_entry(PACKING_EDPK)},
        threshold_n="1",
        threshold_m="1",
    )
    gi02_init = base_init(
        signers={
            "0": signer_entry(four[0], "A"),
            "1": signer_entry(four[1], "A"),
            "2": signer_entry(four[2], "B"),
            "3": signer_entry(four[3], "B"),
        },
        threshold_n="4",
        threshold_m="4",
        class_minima={"A": "1", "B": "1"},
    )
    gi03_init = base_init(
        signers={
            "0": signer_entry(rotated[0], "A"),
            "1": signer_entry(four[1], "A"),
            "2": signer_entry(four[2], "B"),
            "3": signer_entry(four[3], "B"),
        },
        threshold_n="4",
        threshold_m="4",
        class_minima={"A": "1", "B": "1"},
    )
    gi04_init = base_init(
        signers={str(i): signer_entry(four[i]) for i in range(4)},
        threshold_n="4",
        threshold_m="4",
    )
    gi05_init = base_init(
        signers={"0": signer_entry(PACKING_EDPK)},
        threshold_n="1",
        threshold_m="1",
        groups={"ALT": ["BTC_USD"], "CORE": ["XTZ_USD"]},
        assets={"BTC_USD": _btc_policy(), "XTZ_USD": _xtz_policy()},
    )
    gi06_init = base_init(
        signers={
            "0": signer_entry(sparse[0]),
            "1": signer_entry(sparse[1]),
            "5": signer_entry(sparse[2]),
            "9": signer_entry(sparse[3]),
        },
        threshold_n="4",
        threshold_m="4",
    )
    gi07_init = base_init(
        signers={str(i): signer_entry(sixteen[i]) for i in range(16)},
        threshold_n="16",
        threshold_m="16",
    )
    gi08_init = base_init(
        signers={"0": signer_entry(PACKING_EDPK)},
        threshold_n="1",
        threshold_m="1",
        assets={"XTZ_USD": _xtz_policy(decimals="18")},
    )
    long_class = "C" * 64
    gi09_init = base_init(
        signers={"0": signer_entry(utf_edpk, class_id="класс-B-κατηγορία-" + long_class)},
        threshold_n="1",
        threshold_m="1",
    )

    specs = [
        ("GI-01", "1-of-1 config intent; packing fixture edpk; empty class_minima", gi01_init, "config"),
        ("GI-02", "4-of-4 with class minima A:1 B:1", gi02_init, "config"),
        ("GI-03", "4-of-4 key rotation (index 0 replaced)", gi03_init, "config"),
        ("GI-04", "4-of-4 with empty class_minima", gi04_init, "config"),
        ("GI-05", "two publication groups CORE and ALT", gi05_init, "config"),
        ("GI-06", "sparse signer map keys 0,1,5,9", gi06_init, "config"),
        ("GI-07", "16 signers (MAX_SIGNERS)", gi07_init, "config"),
        ("GI-08", "decimals=18 and price_nat_max = 2^96-1", gi08_init, "config"),
        ("GI-09", "non-ASCII and long class_id", gi09_init, "config"),
    ]

    for ident, description, init, _kind in specs:
        intent = config_intent(init)
        packed = pack_config_intent(intent)
        write_vector(
            OUT / f"{ident}.json",
            {
                "id": ident,
                "description": description,
                "kind": "config",
                "intent": intent,
                "packed_hex": packed,
                "blake2b_hex": payload_digest(packed),
            },
        )

    cancel = {
        "domain": CONFIG_CANCEL_DOMAIN,
        "chain_id": CHAIN,
        "oracle_address": ORACLE,
        "current_config_version": "1",
        "governance_nonce": "3",
        "valid_until": VALID_UNTIL,
    }
    packed = pack_simple_intent(cancel)
    write_vector(
        OUT / "GI-10.json",
        {
            "id": "GI-10",
            "description": "config cancel intent",
            "kind": "simple",
            "intent": cancel,
            "packed_hex": packed,
            "blake2b_hex": payload_digest(packed),
        },
    )

    unpause = {**cancel, "domain": UNPAUSE_DOMAIN, "governance_nonce": "4"}
    packed = pack_simple_intent(unpause)
    write_vector(
        OUT / "GI-11.json",
        {
            "id": "GI-11",
            "description": "global unpause intent",
            "kind": "simple",
            "intent": unpause,
            "packed_hex": packed,
            "blake2b_hex": payload_digest(packed),
        },
    )

    asset_xtz = {
        "domain": ASSET_UNPAUSE_DOMAIN,
        "chain_id": CHAIN,
        "oracle_address": ORACLE,
        "current_config_version": "1",
        "governance_nonce": "5",
        "valid_until": VALID_UNTIL,
        "asset_id": "XTZ_USD",
    }
    packed = pack_asset_intent(asset_xtz)
    write_vector(
        OUT / "GI-12.json",
        {
            "id": "GI-12",
            "description": "asset unpause XTZ_USD",
            "kind": "asset",
            "intent": asset_xtz,
            "packed_hex": packed,
            "blake2b_hex": payload_digest(packed),
        },
    )

    asset_btc = {**asset_xtz, "asset_id": "BTC_USD"}
    packed = pack_asset_intent(asset_btc)
    write_vector(
        OUT / "GI-13.json",
        {
            "id": "GI-13",
            "description": "asset unpause BTC_USD (same prefix as GI-12, different asset_id)",
            "kind": "asset",
            "intent": asset_btc,
            "packed_hex": packed,
            "blake2b_hex": payload_digest(packed),
        },
    )

    print(f"wrote {len(list(OUT.glob('GI-*.json')))} vectors under {OUT}")


if __name__ == "__main__":
    freeze()
