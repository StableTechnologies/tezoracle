"""Load the committed parameter register for packing and policy_hash."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from contract.canonical import blake2b256_utf8, canonical_json

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config"


@dataclass(frozen=True)
class RegisterPolicy:
    groups: dict[str, list[str]]
    decimals: dict[str, int]
    price_nat_max: int


def load_snapshot(config_dir: Path | None = None) -> dict[str, Any]:
    directory = Path(config_dir) if config_dir is not None else DEFAULT_CONFIG
    register = json.loads((directory / "register.json").read_text())
    assets: dict[str, Any] = {}
    for asset_id in register["assets"]:
        assets[asset_id] = json.loads((directory / "assets" / f"{asset_id}.json").read_text())
    return {"register": register, "assets": assets}


def policy_from_snapshot(snapshot: dict[str, Any]) -> RegisterPolicy:
    groups = {
        name: list(spec["asset_ids"])
        for name, spec in snapshot["register"]["publication_groups"].items()
    }
    decimals = {asset_id: int(asset["decimals"]) for asset_id, asset in snapshot["assets"].items()}
    return RegisterPolicy(
        groups=groups,
        decimals=decimals,
        price_nat_max=int(snapshot["register"]["payload"]["price_nat_max"]),
    )


def hash_policy_snapshot(snapshot: dict[str, Any]) -> str:
    return blake2b256_utf8(canonical_json(snapshot))


_cached: tuple[dict[str, Any], RegisterPolicy, str] | None = None


def load_committed_register(config_dir: Path | None = None) -> tuple[dict[str, Any], RegisterPolicy, str]:
    global _cached
    if _cached is not None and config_dir is None:
        return _cached
    snapshot = load_snapshot(config_dir)
    policy = policy_from_snapshot(snapshot)
    digest = hash_policy_snapshot(snapshot)
    result = (snapshot, policy, digest)
    if config_dir is None:
        _cached = result
    return result
