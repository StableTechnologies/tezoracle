from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from contract.packing import assert_signature_verifies, payload_to_sp
from contract.payload import PackError, parse_logical_payload
import smartpy as sp
from contract import packing as packing_mod

ROOT = Path(__file__).resolve().parents[2]
GV01 = json.loads((ROOT / "tests/packing/vectors/GV-01.json").read_text())
KEYS = json.loads((ROOT / "tests/packing/keys/ed25519.test.json").read_text())


def _mutate(payload: dict, **fields: object) -> dict:
    out = copy.deepcopy(payload)
    out.update(fields)
    return out


def test_original_signature_verifies_on_packed_bytes() -> None:
    parse_logical_payload(GV01["payload"])
    assert_signature_verifies(GV01["packed_hex"], KEYS["public_key"], KEYS["signatures"]["GV-01"]["edsig"])


def test_smartpy_pack_of_unchecked_tamper_changes_bytes() -> None:
    payload = copy.deepcopy(GV01["payload"])
    payload["round"] = "2"
    scenario = sp.test_scenario(None, packing_mod.main)
    contract = packing_mod.main.Packer()
    scenario += contract
    contract.pack_payload(payload_to_sp(payload, canonical=True))
    assert str(contract.data.packed) != "0x" + GV01["packed_hex"]


@pytest.mark.parametrize(
    ("field", "mutated"),
    [
        ("domain", _mutate(GV01["payload"], domain="TEZORACLE_V2")),
        ("chain_id", _mutate(GV01["payload"], chain_id="NetXdQprcVkpaWU")),
        ("oracle_address", _mutate(GV01["payload"], oracle_address="KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton")),
        ("config_version", _mutate(GV01["payload"], config_version="2")),
        ("policy_hash", _mutate(GV01["payload"], policy_hash=GV01["payload"]["policy_hash"][:-1] + ("0" if GV01["payload"]["policy_hash"][-1] != "0" else "1"))),
        ("publication_group", _mutate(GV01["payload"], publication_group="USDTZ")),
        ("round", _mutate(GV01["payload"], round="2")),
        ("valid_from", _mutate(GV01["payload"], valid_from=str(int(GV01["payload"]["valid_from"]) + 1))),
        ("valid_until", _mutate(GV01["payload"], valid_until=str(int(GV01["payload"]["valid_until"]) + 1))),
        ("evidence_digest", _mutate(GV01["payload"], evidence_digest=GV01["payload"]["evidence_digest"][:-1] + ("0" if GV01["payload"]["evidence_digest"][-1] != "0" else "1"))),
    ],
)
def test_tampered_payload_is_rejected_by_packer_or_changes_smartpy_pack(field: str, mutated: dict) -> None:
    try:
        parse_logical_payload(mutated)
        packable = True
    except PackError:
        packable = False
    if packable:
        scenario = sp.test_scenario(None, packing_mod.main)
        contract = packing_mod.main.Packer()
        scenario += contract
        contract.pack_payload(payload_to_sp(mutated, canonical=True))
        assert str(contract.data.packed) != "0x" + GV01["packed_hex"], field
    # Contract CHECK_SIGNATURE over the original signature must not accept a different packed value.
    if packable:
        with pytest.raises(Exception):
            assert_signature_verifies(
                str(contract.data.packed)[2:],
                KEYS["public_key"],
                KEYS["signatures"]["GV-01"]["edsig"],
            )
    else:
        scenario = sp.test_scenario(None, packing_mod.main)
        contract = packing_mod.main.Packer()
        scenario += contract
        contract.pack_payload(payload_to_sp(mutated, canonical=False))
        packed = str(contract.data.packed)
        assert packed != "0x" + GV01["packed_hex"], field
        with pytest.raises(Exception):
            assert_signature_verifies(
                packed[2:],
                KEYS["public_key"],
                KEYS["signatures"]["GV-01"]["edsig"],
            )


def test_asset_field_tampers_change_smartpy_pack() -> None:
    payload = copy.deepcopy(GV01["payload"])
    original_assets = payload["assets"]
    cases = {
        "asset_order": [original_assets[2], original_assets[0], original_assets[1]],
        "asset_id": [{**original_assets[0], "asset_id": "BTC_USDX"}, original_assets[1], original_assets[2]],
        "price": [{**original_assets[0], "price": str(int(original_assets[0]["price"]) + 1)}, original_assets[1], original_assets[2]],
        "decimals": [{**original_assets[0], "decimals": "7"}, original_assets[1], original_assets[2]],
        "observation_time": [{**original_assets[0], "observation_time": str(int(original_assets[0]["observation_time"]) + 1)}, original_assets[1], original_assets[2]],
    }
    for field, assets in cases.items():
        mutated = _mutate(payload, assets=assets)
        scenario = sp.test_scenario(None, packing_mod.main)
        contract = packing_mod.main.Packer()
        scenario += contract
        contract.pack_payload(payload_to_sp(mutated, canonical=False))
        packed = str(contract.data.packed)
        assert packed != "0x" + GV01["packed_hex"], field
        with pytest.raises(Exception):
            assert_signature_verifies(
                packed[2:],
                KEYS["public_key"],
                KEYS["signatures"]["GV-01"]["edsig"],
            )
