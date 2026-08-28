from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from contract.evidence import EvidenceError, hash_shared_manifest, verify_shared_manifest
from contract.register import load_committed_register

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "tests/packing/evidence/GV-01.json").read_text())
LOCAL = json.loads((ROOT / "tests/packing/evidence/GV-01.signer-local.json").read_text())
GV01 = json.loads((ROOT / "tests/packing/vectors/GV-01.json").read_text())
GV02 = json.loads((ROOT / "tests/packing/vectors/GV-02.json").read_text())
GV02_EVIDENCE = json.loads((ROOT / "tests/packing/evidence/GV-02.json").read_text())


def test_manifest_binds_each_asset_and_matches_payload() -> None:
    snapshot, _policy, policy_hash = load_committed_register()
    assert MANIFEST["policy_hash"] == policy_hash
    payload_assets = GV01["payload"]["assets"]
    assert [asset["asset_id"] for asset in MANIFEST["assets"]] == [asset["asset_id"] for asset in payload_assets]
    for evidence, payload in zip(MANIFEST["assets"], payload_assets, strict=True):
        assert evidence["price"] == payload["price"]
        assert str(evidence["decimals"]) == payload["decimals"]
        assert str(evidence["observation_time"]) == payload["observation_time"]
        assert evidence["calculation"]["aggregation"] == "median_lower"
        assert evidence["sources"], evidence["asset_id"]
    verify_shared_manifest(MANIFEST, GV01["payload"], snapshot, policy_hash)


def test_single_asset_mutations_change_digest() -> None:
    baseline = hash_shared_manifest(MANIFEST)
    source = copy.deepcopy(MANIFEST)
    source["assets"][0]["sources"][0]["endpoint"] = "https://evil.example/api"
    assert hash_shared_manifest(source) != baseline
    time = copy.deepcopy(MANIFEST)
    time["assets"][1]["sources"][0]["venue_observation_time"] += 1
    assert hash_shared_manifest(time) != baseline
    decimals = copy.deepcopy(MANIFEST)
    decimals["assets"][2]["decimals"] = 7
    assert hash_shared_manifest(decimals) != baseline
    policy = copy.deepcopy(MANIFEST)
    policy["assets"][0]["calculation"]["aggregation"] = "mean"
    assert hash_shared_manifest(policy) != baseline


def test_signer_local_record_is_outside_the_digest() -> None:
    assert LOCAL["domain"] == "TEZORACLE_SIGNER_EVIDENCE_V1"
    assert hash_shared_manifest(MANIFEST) == GV01["payload"]["evidence_digest"]
    mixed = {"quorum": MANIFEST, "signer_local": LOCAL}
    assert hash_shared_manifest(mixed) != hash_shared_manifest(MANIFEST)


def test_verification_fail_closes_on_digest_min_and_policy() -> None:
    snapshot, _policy, policy_hash = load_committed_register()
    payload = copy.deepcopy(GV01["payload"])
    payload["evidence_digest"] = "11" * 32
    with pytest.raises(EvidenceError, match="EVIDENCE_DIGEST"):
        verify_shared_manifest(MANIFEST, payload, snapshot, policy_hash)

    reduced = copy.deepcopy(MANIFEST)
    reduced["assets"][0]["sources"] = reduced["assets"][0]["sources"][:1]
    reduced["assets"][0]["calculation"]["contributing_source_ids"] = [
        source["source_id"] for source in reduced["assets"][0]["sources"]
    ]
    reduced_payload = copy.deepcopy(GV01["payload"])
    reduced_payload["evidence_digest"] = hash_shared_manifest(reduced)
    with pytest.raises(EvidenceError, match="EVIDENCE_MIN"):
        verify_shared_manifest(reduced, reduced_payload, snapshot, policy_hash)

    with pytest.raises(EvidenceError, match="EVIDENCE_MIN"):
        verify_shared_manifest(GV02_EVIDENCE, GV02["payload"], snapshot, policy_hash)
