from __future__ import annotations

import json
from pathlib import Path

import pytest

from contract.canonical import blake2b256_utf8, canonical_json
from contract.evidence import EvidenceError, hash_shared_manifest, verify_shared_manifest
from contract.payload import parse_logical_payload
from contract.register import load_committed_register

ROOT = Path(__file__).resolve().parents[2]
VECTORS = sorted((ROOT / "tests/packing/vectors").glob("GV-*.json"))
EVIDENCE = ROOT / "tests/packing/evidence"


def test_policy_hash_and_evidence_digest_match_committed_sources() -> None:
    snapshot, _policy, policy_hash = load_committed_register()
    assert policy_hash == blake2b256_utf8(canonical_json(snapshot))
    for path in VECTORS:
        vector = json.loads(path.read_text())
        payload = parse_logical_payload(vector["payload"])
        assert payload["policy_hash"] == policy_hash, path.name
        evidence_id = vector.get("evidence_id", vector["id"])
        manifest = json.loads((EVIDENCE / f"{evidence_id}.json").read_text())
        assert hash_shared_manifest(manifest) == payload["evidence_digest"], path.name
        if payload["publication_group"] == "CORE":
            verify_shared_manifest(manifest, payload, snapshot, policy_hash)
        else:
            with pytest.raises(EvidenceError, match="EVIDENCE_MIN"):
                verify_shared_manifest(manifest, payload, snapshot, policy_hash)
