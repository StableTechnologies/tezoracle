from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = json.loads((ROOT / "tests/packing/keys/ed25519.test.json").read_text())


def test_packing_edsk_is_synthetic_test_only() -> None:
    assert KEYS["label"] == "tezoracle-packing-test-ed25519-v1"
    assert "SYNTHETIC TEST-ONLY KEY" in KEYS["note"]
    assert "Never funded" in KEYS["note"]
    assert KEYS["secret_key"].startswith("edsk")
    assert KEYS["public_key_hash"] == "tz1d7tgjjqBB3nNpsB5NtqA2gFZQEU9eAdpC"
