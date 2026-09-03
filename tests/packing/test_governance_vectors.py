from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from contract.governance_pack import pack_asset_intent, pack_config_intent, pack_init
from contract.payload import payload_digest

ROOT = Path(__file__).resolve().parents[2]
VECTORS = sorted((ROOT / "tests/packing/governance").glob("GI-*.json"))


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def test_smartpy_pack_matches_frozen_governance_vectors() -> None:
    assert VECTORS, "expected GI-*.json; run scripts/freeze-governance-vectors.py"
    for path in VECTORS:
        vector = load(path)
        intent = vector["intent"]
        kind = vector["kind"]
        if kind == "config":
            packed = pack_config_intent(intent)
        elif kind == "simple":
            from contract.governance_pack import pack_simple_intent

            packed = pack_simple_intent(intent)
        elif kind == "asset":
            packed = pack_asset_intent(intent)
        else:
            raise AssertionError(kind)
        assert packed == vector["packed_hex"], path.name
        assert payload_digest(packed) == vector["blake2b_hex"], path.name


def test_map_insertion_order_does_not_change_packed_init() -> None:
    vector = load(ROOT / "tests/packing/governance/GI-05.json")
    init = deepcopy(vector["intent"]["init"])
    assets = init["assets"]
    reversed_assets = {key: assets[key] for key in reversed(list(assets))}
    init_rev = {**init, "assets": reversed_assets}
    groups = init["groups"]
    reversed_groups = {key: groups[key] for key in reversed(list(groups))}
    init_rev["groups"] = reversed_groups
    assert list(init["assets"]) != list(init_rev["assets"])
    assert pack_init(init) == pack_init(init_rev)


def test_asset_id_and_domain_change_packed_bytes() -> None:
    gi12 = load(ROOT / "tests/packing/governance/GI-12.json")
    gi13 = load(ROOT / "tests/packing/governance/GI-13.json")
    gi10 = load(ROOT / "tests/packing/governance/GI-10.json")
    gi11 = load(ROOT / "tests/packing/governance/GI-11.json")
    assert gi12["packed_hex"] != gi13["packed_hex"]
    assert gi10["packed_hex"] != gi11["packed_hex"]
    assert gi10["intent"]["domain"] != gi11["intent"]["domain"]
