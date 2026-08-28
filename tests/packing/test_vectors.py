from __future__ import annotations

import json
from pathlib import Path

import pytest

from contract.packing import assert_pack_equals
from contract.payload import PackError, chain_id_hex, parse_logical_payload, payload_digest

ROOT = Path(__file__).resolve().parents[2]
VECTORS = sorted((ROOT / "tests/packing/vectors").glob("GV-*.json"))


def load_vector(path: Path) -> dict:
    return json.loads(path.read_text())


def test_chain_id_hex_matches_known_networks() -> None:
    assert chain_id_hex("NetXnHfVqm9iesp") == "af1864d9"
    assert chain_id_hex("NetXdQprcVkpaWU") == "7a06a770"
    with pytest.raises(PackError) as exc:
        chain_id_hex("NetXdQprjJrJcWw")
    assert exc.value.code == "CHAIN"


@pytest.mark.parametrize("path", VECTORS, ids=lambda path: path.stem)
def test_smartpy_pack_matches_frozen_vector(path: Path) -> None:
    vector = load_vector(path)
    parse_logical_payload(vector["payload"])
    assert payload_digest(vector["packed_hex"]) == vector["blake2b_hex"]
    assert_pack_equals(vector["payload"], vector["packed_hex"])


def test_python_rejects_silent_reorder_and_unknown_fields() -> None:
    payload = load_vector(ROOT / "tests/packing/vectors/GV-01.json")["payload"]
    reordered = {
        **payload,
        "assets": [payload["assets"][2], payload["assets"][0], payload["assets"][1]],
    }
    with pytest.raises(PackError) as exc:
        parse_logical_payload(reordered)
    assert exc.value.code == "ASSETS_SET"

    with pytest.raises(PackError) as extra:
        parse_logical_payload({**payload, "tolerance": 1})
    assert extra.value.code == "PACK"
