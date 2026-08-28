"""Protocol-level origination and submit size/gas via octez-client mockup."""

from __future__ import annotations

import json
import shutil

import pytest

from contract.octez_ops import MAX_GROUP_SIZE, OCTEZ_MAX_ANNOTATION, ROOT, measure
from tests.contract.test_compile import EVENT_TAGS

COMMITTED = ROOT / "docs" / "octez_measurements.json"


def test_event_tags_fit_protocol_annotation_limit():
    for tag in EVENT_TAGS:
        assert len(tag) <= OCTEZ_MAX_ANNOTATION, tag


def test_committed_octez_measurements_under_protocol_limits():
    report = json.loads(COMMITTED.read_text())
    assert report["protocol_name"] == "Ushuaia"
    assert report["maximum_tested_publication_group_size"] == MAX_GROUP_SIZE
    max_op = report["max_operation_data_length"]
    gas_cap = report["hard_gas_limit_per_operation"]
    assert report["michelson_text_bytes"] > max_op
    assert report["encoded_script_bytes"] < max_op
    names = {op["name"] for op in report["operations"]}
    assert "originate:tezoracle_3of4" in names
    assert "submit:tezoracle_3of4" in names
    assert "originate:tezoracle_5of7" in names
    assert "submit:tezoracle_5of7" in names
    assert "submit:tezoracle_5of7_maxgroup" in names
    for op in report["operations"]:
        assert op["succeeded"], op
        assert op["encoded_operation_bytes"] < max_op, op["name"]
        assert op["consumed_gas"] < gas_cap, op["name"]
        assert op["paid_storage_diff_bytes"] is not None, op["name"]
        assert op["fee_tez"], op["name"]


@pytest.mark.skipif(
    shutil.which("octez-client") is None,
    reason="octez-client is not installed",
)
def test_ushuaia_mockup_origination_and_submits():
    report = measure()
    assert report["protocol_name"] == "Ushuaia"
    assert report["maximum_tested_publication_group_size"] == MAX_GROUP_SIZE
    max_op = report["max_operation_data_length"]
    gas_cap = report["hard_gas_limit_per_operation"]
    assert report["michelson_text_bytes"] > max_op
    if report["encoded_script_bytes"] is not None:
        assert report["encoded_script_bytes"] < max_op
    ops = {op["name"]: op for op in report["operations"]}
    for name, op in ops.items():
        assert op["succeeded"], f"{name}: {op['notes']}"
        assert op["encoded_operation_bytes"] is not None, name
        assert op["encoded_operation_bytes"] < max_op, name
        assert op["consumed_gas"] is not None, name
        assert op["consumed_gas"] < gas_cap, name
    orig = [op for op in report["operations"] if op["name"].startswith("originate:")]
    submit = [op for op in report["operations"] if op["name"].startswith("submit:")]
    assert len(orig) == 3
    assert len(submit) == 3
    assert (
        ops["submit:tezoracle_5of7_maxgroup"]["encoded_operation_bytes"]
        >= ops["submit:tezoracle_3of4"]["encoded_operation_bytes"]
    )
