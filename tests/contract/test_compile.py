"""Originate the contract and capture compiled Michelson."""

from pathlib import Path

import smartpy as sp

from contract.compile import normalize_source_locations, strip_stack_comments
from contract.oracle import main
from tests.contract.harness import originate_1of1

ROOT = Path(__file__).resolve().parents[2]
MICHELSON = ROOT / "michelson" / "tezoracle.tz"


def test_originates_1_of_1_and_matches_committed_michelson():
    scenario, contract, _packer, _admin, _guardian, _accounts = originate_1of1()
    result = contract.origination_result
    code = result["code_tz"]
    assert isinstance(code, str)
    assert "CHECK_SIGNATURE" in code
    scenario.verify(contract.data.threshold_n == 1)
    scenario.verify(contract.data.threshold_m == 1)
    scenario.verify(contract.data.activation_delay_levels == 1)
    scenario.verify(contract.data.paused == False)
    generated = strip_stack_comments(code)
    committed = MICHELSON.read_text()
    assert normalize_source_locations(committed) == normalize_source_locations(
        generated
    )
    assert "CHECK_SIGNATURE" in committed
    assert "view" in committed
    assert 1_000 < len(committed) < 500_000


def test_payload_type_matches_frozen_gv01():
    import json

    from contract.packing import payload_to_sp

    vector = json.loads(
        (ROOT / "tests/packing/vectors/GV-01.json").read_text()
    )
    scenario = sp.test_scenario(None, main)
    packer = main.Packer()
    scenario += packer
    packer.pack_payload(payload_to_sp(vector["payload"]))
    scenario.verify(packer.data.packed == sp.bytes("0x" + vector["packed_hex"]))
