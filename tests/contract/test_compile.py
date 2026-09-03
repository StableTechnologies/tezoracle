"""Originate the contract and capture compiled Michelson."""

from pathlib import Path

import smartpy as sp

from contract.compile import normalize_source_locations, strip_stack_comments
from contract.oracle import main
from tests.contract.harness import originate_1of1

ROOT = Path(__file__).resolve().parents[2]
MICHELSON = ROOT / "michelson" / "tezoracle.tz"


EVENT_TAGS = (
    "tezoracle_submit",
    "tezoracle_pause",
    "tezoracle_unpause_propose",
    "tezoracle_unpause_activate",
    "tezoracle_unpause_cancel",
    "tezoracle_asset_pause",
    "tezoracle_asset_unpause_prop",
    "tezoracle_asset_unpause_act",
    "tezoracle_asset_unpause_cancel",
    "tezoracle_movement_pause",
    "tezoracle_config_propose",
    "tezoracle_config_cancel",
    "tezoracle_config_activate",
    "tezoracle_pending_discard",
)


def _init_comb_type(src: str) -> str:
    """t_init comb as compiled into %init / propose_config intent."""
    marker = "(pair %init (nat %activation_delay_levels)"
    start = src.index(marker)
    # Take through validity_window_seconds closing the init record.
    end = src.index("(nat %validity_window_seconds)", start)
    # include the field and the following closing parens that belong to init
    # is brittle; compare a stable inner prefix instead.
    return src[start : end + len("(nat %validity_window_seconds)")]


def test_t_init_layout_matches_committed_propose_config_abi():
    """Explicit t_init.layout must keep the compiled alphabetical comb.

    Source-line FAILWITH integers may move; the init comb must not.
    """
    _scenario, contract, _packer, _admin, _guardian, _accounts = originate_1of1()
    generated = strip_stack_comments(contract.origination_result["code_tz"])
    committed = MICHELSON.read_text()
    assert _init_comb_type(generated) == _init_comb_type(committed)
    assert normalize_source_locations(committed) == normalize_source_locations(
        generated
    )


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
    for tag in EVENT_TAGS:
        assert tag in generated
        assert tag in committed
        assert len(tag) <= 31, tag


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
