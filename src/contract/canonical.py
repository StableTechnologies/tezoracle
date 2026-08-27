"""Canonical JSON preimage for policy_hash and evidence_digest.

Must match src/canonical.ts: sorted object keys, compact separators,
UTF-8, no ASCII-only escaping of non-ASCII.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def blake2b256_utf8(text: str) -> str:
    return hashlib.blake2b(text.encode("utf-8"), digest_size=32).hexdigest()
