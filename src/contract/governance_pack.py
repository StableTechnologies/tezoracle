"""SmartPy PACK for governance intents. Bytes come from Packer.sp.pack, not from reading field order in oracle.py."""

from __future__ import annotations

import re
from typing import Any, Mapping

import smartpy as sp

from contract.oracle import main
from contract.payload import PackError, chain_id_hex

CONFIG_DOMAIN = "TEZORACLE_CONFIG_V1"
CONFIG_CANCEL_DOMAIN = "TEZORACLE_CONFIG_CANCEL_V1"
UNPAUSE_DOMAIN = "TEZORACLE_UNPAUSE_V1"
UNPAUSE_CANCEL_DOMAIN = "TEZORACLE_UNPAUSE_CANCEL_V1"
ASSET_UNPAUSE_DOMAIN = "TEZORACLE_ASSET_UNPAUSE_V1"
ASSET_UNPAUSE_CANCEL_DOMAIN = "TEZORACLE_ASSET_UNPAUSE_CANCEL_V1"

SIMPLE_DOMAINS = frozenset(
    {CONFIG_CANCEL_DOMAIN, UNPAUSE_DOMAIN, UNPAUSE_CANCEL_DOMAIN}
)
ASSET_DOMAINS = frozenset({ASSET_UNPAUSE_DOMAIN, ASSET_UNPAUSE_CANCEL_DOMAIN})

INIT_KEYS = (
    "admin",
    "guardian",
    "config_version",
    "policy_hash",
    "threshold_n",
    "threshold_m",
    "activation_delay_levels",
    "min_activation_delay_levels",
    "max_clock_skew_seconds",
    "validity_window_seconds",
    "price_nat_max",
    "signers",
    "class_minima",
    "groups",
    "assets",
)

CONFIG_INTENT_KEYS = (
    "domain",
    "chain_id",
    "oracle_address",
    "current_config_version",
    "governance_nonce",
    "valid_until",
    "init",
)

SIMPLE_INTENT_KEYS = (
    "domain",
    "chain_id",
    "oracle_address",
    "current_config_version",
    "governance_nonce",
    "valid_until",
)

ASSET_INTENT_KEYS = SIMPLE_INTENT_KEYS + ("asset_id",)

SIGNER_KEYS = ("public_key", "class_id", "active")
ASSET_POLICY_KEYS = (
    "decimals",
    "max_observation_age_seconds",
    "absolute_min_price",
    "absolute_max_price",
    "max_movement_bps",
)

_NAT = re.compile(r"^(0|[1-9][0-9]*)$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_PACKED_HTML = re.compile(r"<span class='bytes'>0x([0-9a-f]+)</span>")


def _require_keys(raw: Mapping[str, Any], allowed: tuple[str, ...], label: str) -> None:
    extra = [key for key in raw if key not in allowed]
    missing = [key for key in allowed if key not in raw]
    if extra:
        raise PackError("PACK", f"unknown {label} field(s) {', '.join(extra)}")
    if missing:
        raise PackError("PACK", f"missing {label} field(s) {', '.join(missing)}")


def _nat_string(value: Any, field: str) -> int:
    if not isinstance(value, str) or not _NAT.match(value):
        raise PackError("PACK", f"{field} must be an unsigned decimal string")
    return int(value)


def _hex32(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _HEX64.match(value):
        raise PackError("POLICY", f"{field} must be 64 lowercase hex characters")
    return value


def init_to_sp(init: Mapping[str, Any]) -> Any:
    _require_keys(init, INIT_KEYS, "init")
    signers: dict[int, Any] = {}
    for key, signer in init["signers"].items():
        index = _nat_string(key if isinstance(key, str) else str(key), "signers index")
        _require_keys(signer, SIGNER_KEYS, "signer")
        if not isinstance(signer["class_id"], str) or len(signer["class_id"]) < 1:
            raise PackError("PACK", "class_id must be a non-empty string")
        if not isinstance(signer["active"], bool):
            raise PackError("PACK", "signer.active must be a JSON boolean")
        if not isinstance(signer["public_key"], str) or not signer["public_key"].startswith("edpk"):
            raise PackError("PACK", "signer.public_key must be an edpk")
        signers[index] = sp.record(
            public_key=sp.key(signer["public_key"]),
            class_id=signer["class_id"],
            active=signer["active"],
        )
    assets: dict[str, Any] = {}
    for asset_id, policy in init["assets"].items():
        _require_keys(policy, ASSET_POLICY_KEYS, "asset policy")
        assets[asset_id] = sp.record(
            decimals=_nat_string(policy["decimals"], "decimals"),
            max_observation_age_seconds=_nat_string(
                policy["max_observation_age_seconds"], "max_observation_age_seconds"
            ),
            absolute_min_price=_nat_string(policy["absolute_min_price"], "absolute_min_price"),
            absolute_max_price=_nat_string(policy["absolute_max_price"], "absolute_max_price"),
            max_movement_bps=_nat_string(policy["max_movement_bps"], "max_movement_bps"),
        )
    groups = {
        name: list(ids) for name, ids in init["groups"].items()
    }
    minima = {
        class_id: _nat_string(value if isinstance(value, str) else str(value), "class_minima")
        for class_id, value in init["class_minima"].items()
    }
    return sp.record(
        admin=sp.address(init["admin"]),
        guardian=sp.address(init["guardian"]),
        config_version=_nat_string(init["config_version"], "config_version"),
        policy_hash=sp.bytes("0x" + _hex32(init["policy_hash"], "policy_hash")),
        threshold_n=_nat_string(init["threshold_n"], "threshold_n"),
        threshold_m=_nat_string(init["threshold_m"], "threshold_m"),
        activation_delay_levels=_nat_string(
            init["activation_delay_levels"], "activation_delay_levels"
        ),
        min_activation_delay_levels=_nat_string(
            init["min_activation_delay_levels"], "min_activation_delay_levels"
        ),
        max_clock_skew_seconds=_nat_string(
            init["max_clock_skew_seconds"], "max_clock_skew_seconds"
        ),
        validity_window_seconds=_nat_string(
            init["validity_window_seconds"], "validity_window_seconds"
        ),
        price_nat_max=_nat_string(init["price_nat_max"], "price_nat_max"),
        signers=signers,
        class_minima=minima,
        groups=groups,
        assets=assets,
    )


def _prefix_sp(intent: Mapping[str, Any], domain: str) -> dict[str, Any]:
    if intent["domain"] != domain:
        raise PackError("DOMAIN", f"domain must be exactly {domain}")
    return {
        "domain": domain,
        "chain_id": sp.chain_id_cst("0x" + chain_id_hex(intent["chain_id"])),
        "oracle_address": sp.address(intent["oracle_address"]),
        "current_config_version": _nat_string(
            intent["current_config_version"], "current_config_version"
        ),
        "governance_nonce": _nat_string(intent["governance_nonce"], "governance_nonce"),
        "valid_until": sp.timestamp(_nat_string(intent["valid_until"], "valid_until")),
    }


def config_intent_to_sp(intent: Mapping[str, Any]) -> Any:
    _require_keys(intent, CONFIG_INTENT_KEYS, "config intent")
    prefix = _prefix_sp(intent, CONFIG_DOMAIN)
    return sp.record(**prefix, init=init_to_sp(intent["init"]))


def simple_intent_to_sp(intent: Mapping[str, Any]) -> Any:
    _require_keys(intent, SIMPLE_INTENT_KEYS, "governance intent")
    domain = intent["domain"]
    if domain not in SIMPLE_DOMAINS:
        raise PackError("DOMAIN", f"unsupported simple governance domain {domain}")
    return sp.record(**_prefix_sp(intent, domain))


def asset_intent_to_sp(intent: Mapping[str, Any]) -> Any:
    _require_keys(intent, ASSET_INTENT_KEYS, "asset governance intent")
    domain = intent["domain"]
    if domain not in ASSET_DOMAINS:
        raise PackError("DOMAIN", f"unsupported asset governance domain {domain}")
    if not isinstance(intent["asset_id"], str) or len(intent["asset_id"]) < 1:
        raise PackError("ASSET_ID", "asset_id must be a non-empty string")
    return sp.record(**_prefix_sp(intent, domain), asset_id=intent["asset_id"])


def _entrypoint_body(scenario: Any) -> dict[str, Any]:
    body = scenario.entrypoint_calls[-1][1]
    message = body.get("message")
    if isinstance(message, dict) and "result" in message:
        return message
    return body


def _packed_hex(scenario: Any) -> str:
    payload = _entrypoint_body(scenario)
    result = payload["result"]
    if result[0] != "Ok":
        raise PackError("PACK", f"GovernancePacker failed: {result!r}")
    html = result[1]["storage_html"]
    match = _PACKED_HTML.search(html)
    if match is None:
        raise PackError("PACK", "GovernancePacker storage did not contain packed bytes")
    packed = match.group(1)
    if not packed.startswith("05"):
        raise PackError("PACK", "PACK output must start with the 0x05 tag")
    return packed


def pack_init(init: Mapping[str, Any]) -> str:
    scenario = sp.test_scenario(None, main)
    packer = main.Packer()
    scenario += packer
    packer.pack_init(init_to_sp(init))
    return _packed_hex(scenario)


def pack_config_intent(intent: Mapping[str, Any]) -> str:
    scenario = sp.test_scenario(None, main)
    packer = main.Packer()
    scenario += packer
    packer.pack_config_intent(config_intent_to_sp(intent))
    return _packed_hex(scenario)


def pack_simple_intent(intent: Mapping[str, Any]) -> str:
    scenario = sp.test_scenario(None, main)
    packer = main.Packer()
    scenario += packer
    packer.pack_simple_intent(simple_intent_to_sp(intent))
    return _packed_hex(scenario)


def pack_asset_intent(intent: Mapping[str, Any]) -> str:
    scenario = sp.test_scenario(None, main)
    packer = main.Packer()
    scenario += packer
    packer.pack_asset_intent(asset_intent_to_sp(intent))
    return _packed_hex(scenario)
