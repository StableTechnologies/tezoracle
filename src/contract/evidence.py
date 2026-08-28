"""Quorum-shared evidence digest and fail-closed verification."""

from __future__ import annotations

import re
from typing import Any, Mapping

from contract.canonical import blake2b256_utf8, canonical_json

SECRET_FIELD = re.compile(r"secret|password|authorization|api[_-]?key|private[_-]?key|mnemonic|credential", re.I)


class EvidenceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def hash_shared_manifest(manifest: Mapping[str, Any]) -> str:
    return blake2b256_utf8(canonical_json(manifest))


def _walk_secrets(value: Any, path: str) -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            _walk_secrets(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        child_path = f"{path}.{key}" if path else str(key)
        if SECRET_FIELD.search(str(key)):
            raise EvidenceError("EVIDENCE_SECRET", f"credential-shaped field {child_path}")
        _walk_secrets(child, child_path)


def _oldest_contributing_time(asset: Mapping[str, Any]) -> int:
    times: list[int] = []
    for source in asset["sources"]:
        times.append(int(source["venue_observation_time"]))
        conversion = source.get("conversion")
        if conversion:
            times.append(int(conversion["factor_observation_time"]))
    if not times:
        return int(asset["observation_time"])
    return min(times)


def _independent_count(sources: list[Mapping[str, Any]]) -> int:
    return len({source["independence_group"] for source in sources})


def verify_shared_manifest(
    manifest: Mapping[str, Any],
    payload: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    policy_hash: str,
) -> None:
    _walk_secrets(manifest, "")
    if hash_shared_manifest(manifest) != payload["evidence_digest"]:
        raise EvidenceError("EVIDENCE_DIGEST", "recomputed manifest digest does not match payload evidence_digest")
    if manifest["policy_hash"] != policy_hash or manifest["policy_hash"] != payload["policy_hash"]:
        raise EvidenceError("EVIDENCE_POLICY", "manifest policy_hash does not match the pinned register")
    if manifest["publication_group"] != payload["publication_group"]:
        raise EvidenceError("EVIDENCE_GROUP", "manifest publication_group does not match payload")
    if str(manifest["round"]) != str(payload["round"]):
        raise EvidenceError("EVIDENCE_GROUP", "manifest round does not match payload")
    expected_ids = snapshot["register"]["publication_groups"][payload["publication_group"]]["asset_ids"]
    if len(manifest["assets"]) != len(payload["assets"]) or len(manifest["assets"]) != len(expected_ids):
        raise EvidenceError("EVIDENCE_GROUP", "manifest asset set does not match payload")
    for expected, actual, expected_id in zip(payload["assets"], manifest["assets"], expected_ids, strict=True):
        if actual["asset_id"] != expected["asset_id"] or actual["asset_id"] != expected_id:
            raise EvidenceError("EVIDENCE_GROUP", f"asset order mismatch at {expected['asset_id']}")
        if actual["price"] != expected["price"] or str(actual["decimals"]) != expected["decimals"]:
            raise EvidenceError("EVIDENCE_PRICE", f"{actual['asset_id']} price/decimals do not match payload")
        if str(actual["observation_time"]) != expected["observation_time"]:
            raise EvidenceError("EVIDENCE_PRICE", f"{actual['asset_id']} observation_time does not match payload")
        if actual["calculation"]["oldest_observation_time"] != actual["observation_time"]:
            raise EvidenceError("EVIDENCE_TIME", f"{actual['asset_id']} oldest_observation_time must equal observation_time")
        if actual["sources"] and _oldest_contributing_time(actual) != actual["observation_time"]:
            raise EvidenceError("EVIDENCE_TIME", f"{actual['asset_id']} observation_time is not the min contributing time")
        contributing = [source["source_id"] for source in actual["sources"]]
        if contributing != actual["calculation"]["contributing_source_ids"]:
            raise EvidenceError("EVIDENCE_SOURCE", f"{actual['asset_id']} contributing_source_ids must match sources")
        both = set(contributing)
        for excluded in actual["excluded"]:
            if excluded["source_id"] in both:
                raise EvidenceError("EVIDENCE_SOURCE", f"{excluded['source_id']} cannot be both contributing and excluded")
        asset = snapshot["assets"][actual["asset_id"]]
        if actual["decimals"] != asset["decimals"]:
            raise EvidenceError("EVIDENCE_PRICE", f"{actual['asset_id']} decimals do not match the register")
        if actual["calculation"]["aggregation"] != asset["aggregation"]:
            raise EvidenceError("EVIDENCE_POLICY", f"{actual['asset_id']} aggregation is not the register policy")
        if actual["calculation"]["rounding_mode"] != asset["rounding_mode"]:
            raise EvidenceError("EVIDENCE_POLICY", f"{actual['asset_id']} rounding_mode is not the register policy")
        if actual["calculation"]["min_independent_observations"] != asset["min_independent_observations"]:
            raise EvidenceError(
                "EVIDENCE_POLICY",
                f"{actual['asset_id']} min_independent_observations is not the register policy",
            )
        independent = _independent_count(actual["sources"])
        if independent < asset["min_independent_observations"]:
            raise EvidenceError(
                "EVIDENCE_MIN",
                f"{actual['asset_id']} has {independent} independent observations; minimum is {asset['min_independent_observations']}",
            )
        allow = {source["source_id"]: source for source in asset["sources"]}
        for observation in actual["sources"]:
            registered = allow.get(observation["source_id"])
            if registered is None:
                raise EvidenceError("EVIDENCE_SOURCE", f"{observation['source_id']} is not in the pinned allowlist")
            registered_unit = registered.get("unit", registered["quote_asset"])
            if (
                observation["venue"] != registered["venue"]
                or observation["independence_group"] != registered["independence_group"]
                or observation["base_asset"] != registered["base_asset"]
                or observation["quote_asset"] != registered["quote_asset"]
                or observation["unit"] != registered_unit
            ):
                raise EvidenceError(
                    "EVIDENCE_SOURCE",
                    f"{observation['source_id']} source identity fields do not match the register",
                )
            if (
                observation["endpoint"] != registered["endpoint"]
                or observation["query"] != registered["query"]
                or observation["market_id"] != registered["market_id"]
            ):
                raise EvidenceError("EVIDENCE_ENDPOINT", f"{observation['source_id']} endpoint/query/market_id mismatch")
            if registered["quote_conversion"] == "usdt_usd":
                conversion = observation.get("conversion")
                if not conversion or conversion.get("via_asset_id") != "USDT_USD":
                    raise EvidenceError(
                        "EVIDENCE_SOURCE",
                        f"{observation['source_id']} is missing the required USDT/USD conversion leg",
                    )
            elif observation.get("conversion") is not None:
                raise EvidenceError("EVIDENCE_SOURCE", f"{observation['source_id']} must not include a conversion leg")
