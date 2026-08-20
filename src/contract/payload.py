"""Canonical payload checks for the SmartPy packing path.

Mirrors src/packing/validate.ts. Unknown fields and asset reordering fail;
they are never silently repaired.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Mapping

DOMAIN = "TEZORACLE_V1"
GROUP_ASSETS = {
    "CORE": ["BTC_USD", "USDT_USD", "XTZ_USD"],
    "USDTZ": ["USDTZ_USD"],
    "TZBTC": ["TZBTC_USD"],
}
ASSET_DECIMALS = {
    "BTC_USD": 6,
    "USDT_USD": 6,
    "XTZ_USD": 6,
    "USDTZ_USD": 6,
    "TZBTC_USD": 6,
}
PRICE_NAT_MAX = (1 << 96) - 1
PAYLOAD_KEYS = (
    "domain",
    "chain_id",
    "oracle_address",
    "config_version",
    "policy_hash",
    "publication_group",
    "round",
    "valid_from",
    "valid_until",
    "evidence_digest",
    "assets",
)
ASSET_KEYS = ("asset_id", "price", "decimals", "observation_time")

_NAT = re.compile(r"^(0|[1-9][0-9]*)$")
_POS = re.compile(r"^[1-9][0-9]*$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_ASSET_ID = re.compile(r"^[A-Z0-9_]+$")
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_NET_PREFIX = bytes([87, 82, 0])


class PackError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


def _b58decode_check(value: str) -> bytes:
    n = 0
    for ch in value:
        try:
            n = n * 58 + _B58.index(ch)
        except ValueError as exc:
            raise PackError("CHAIN", "invalid base58 character") from exc
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(value) - len(value.lstrip("1"))
    raw = b"\x00" * pad + raw
    if len(raw) < 4:
        raise PackError("CHAIN", "invalid base58 payload")
    payload, checksum = raw[:-4], raw[-4:]
    digest = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if digest != checksum:
        raise PackError("CHAIN", "invalid chain_id checksum")
    return payload


def chain_id_hex(chain_id: str) -> str:
    payload = _b58decode_check(chain_id)
    if not payload.startswith(_NET_PREFIX) or len(payload) != 7:
        raise PackError("CHAIN", "not a Tezos chain_id")
    return payload[3:].hex()


def _nat(value: Any, field: str, code: str, minimum: int) -> int:
    if not isinstance(value, str) or not _NAT.match(value):
        raise PackError(code, f"{field} must be an unsigned decimal string")
    n = int(value)
    if n < minimum:
        raise PackError(code, f"{field} out of range")
    return n


def _hex32(value: Any, field: str, code: str) -> None:
    if not isinstance(value, str) or not _HEX64.match(value):
        raise PackError(code, f"{field} must be 64 lowercase hex characters with no 0x prefix")


def parse_logical_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise PackError("PACK", "payload must be an object")
    extra = [k for k in raw if k not in PAYLOAD_KEYS]
    missing = [k for k in PAYLOAD_KEYS if k not in raw]
    if extra:
        raise PackError("PACK", f"unknown field(s) {', '.join(extra)}")
    if missing:
        raise PackError("PACK", f"missing field(s) {', '.join(missing)}")
    if raw["domain"] != DOMAIN:
        raise PackError("DOMAIN", f"domain must be exactly {DOMAIN}")
    if not isinstance(raw["chain_id"], str):
        raise PackError("CHAIN", "chain_id must be a string")
    chain_id_hex(raw["chain_id"])
    address = raw["oracle_address"]
    if not isinstance(address, str) or not address.startswith("KT1") or "%" in address:
        raise PackError("ORACLE", "oracle_address must be a KT1 contract with the default entrypoint")
    _nat(raw["config_version"], "config_version", "CONFIG", 1)
    _hex32(raw["policy_hash"], "policy_hash", "POLICY")
    group = raw["publication_group"]
    if group not in GROUP_ASSETS:
        raise PackError("GROUP", "publication_group must be CORE, USDTZ, or TZBTC")
    _nat(raw["round"], "round", "ROUND", 1)
    valid_from = _nat(raw["valid_from"], "valid_from", "WINDOW", 1)
    valid_until = _nat(raw["valid_until"], "valid_until", "WINDOW", 1)
    if valid_from >= valid_until:
        raise PackError("WINDOW", "valid_from must be strictly less than valid_until")
    _hex32(raw["evidence_digest"], "evidence_digest", "EVIDENCE")
    if not isinstance(raw["assets"], list):
        raise PackError("ASSETS_SET", "assets must be a list")
    assets = [_parse_asset(item) for item in raw["assets"]]
    expected = GROUP_ASSETS[group]
    if [a["asset_id"] for a in assets] != expected:
        raise PackError(
            "ASSETS_SET",
            f"assets must be exactly {', '.join(expected)} in that order; implementations must not sort or fill",
        )
    return dict(raw, assets=assets)


def _parse_asset(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise PackError("PACK", "asset entry must be an object")
    extra = [k for k in raw if k not in ASSET_KEYS]
    missing = [k for k in ASSET_KEYS if k not in raw]
    if extra:
        raise PackError("PACK", f"unknown asset field(s) {', '.join(extra)}")
    if missing:
        raise PackError("PACK", f"missing asset field(s) {', '.join(missing)}")
    asset_id = raw["asset_id"]
    if not isinstance(asset_id, str) or not _ASSET_ID.match(asset_id) or asset_id not in ASSET_DECIMALS:
        raise PackError("ASSET_ID", "unknown or non-canonical asset_id")
    if not isinstance(raw["price"], str) or not _POS.match(raw["price"]):
        raise PackError("PRICE", "price must be a positive decimal string")
    if int(raw["price"]) > PRICE_NAT_MAX:
        raise PackError("PRICE", "price exceeds price_nat_max")
    if not isinstance(raw["decimals"], str) or not _NAT.match(raw["decimals"]):
        raise PackError("DECIMALS", "decimals must be an unsigned decimal string")
    if int(raw["decimals"]) != ASSET_DECIMALS[asset_id]:
        raise PackError("DECIMALS", f"decimals must be {ASSET_DECIMALS[asset_id]} for {asset_id}")
    _nat(raw["observation_time"], "observation_time", "OBS_ZERO", 1)
    return dict(raw)


def payload_digest(packed_hex: str) -> str:
    return hashlib.blake2b(bytes.fromhex(packed_hex), digest_size=32).hexdigest()
