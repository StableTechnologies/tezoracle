"""SmartPy packing reference for the frozen TezOracle payload type."""

from __future__ import annotations

from typing import Any, Mapping

import smartpy as sp

from contract.payload import chain_id_hex, parse_logical_payload


@sp.module
def main():
    t_asset: type = sp.record(
        asset_id=sp.string,
        price=sp.nat,
        decimals=sp.nat,
        observation_time=sp.timestamp,
    ).layout(("asset_id", ("price", ("decimals", "observation_time"))))

    t_payload: type = sp.record(
        domain=sp.string,
        chain_id=sp.chain_id,
        oracle_address=sp.address,
        config_version=sp.nat,
        policy_hash=sp.bytes,
        publication_group=sp.string,
        round=sp.nat,
        valid_from=sp.timestamp,
        valid_until=sp.timestamp,
        evidence_digest=sp.bytes,
        assets=sp.list[t_asset],
    ).layout(
        (
            "domain",
            (
                "chain_id",
                (
                    "oracle_address",
                    (
                        "config_version",
                        (
                            "policy_hash",
                            (
                                "publication_group",
                                (
                                    "round",
                                    (
                                        "valid_from",
                                        ("valid_until", ("evidence_digest", "assets")),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )
    )

    class Packer(sp.Contract):
        def __init__(self):
            self.data.packed = sp.bytes("0x")

        @sp.entrypoint
        def pack_payload(self, payload):
            sp.cast(payload, t_payload)
            self.data.packed = sp.pack(payload)

        @sp.entrypoint
        def check_sig(self, packed, public_key, signature):
            assert sp.check_signature(public_key, signature, packed)


def payload_to_sp(payload: Mapping[str, Any], *, canonical: bool = True) -> Any:
    logical = parse_logical_payload(payload) if canonical else dict(payload)
    assets = [
        sp.record(
            asset_id=asset["asset_id"],
            price=sp.nat(int(asset["price"])),
            decimals=sp.nat(int(asset["decimals"])),
            observation_time=sp.timestamp(int(asset["observation_time"])),
        )
        for asset in logical["assets"]
    ]
    return sp.record(
        domain=logical["domain"],
        chain_id=sp.chain_id_cst("0x" + chain_id_hex(logical["chain_id"])),
        oracle_address=sp.address(logical["oracle_address"]),
        config_version=sp.nat(int(logical["config_version"])),
        policy_hash=sp.bytes("0x" + logical["policy_hash"]),
        publication_group=logical["publication_group"],
        round=sp.nat(int(logical["round"])),
        valid_from=sp.timestamp(int(logical["valid_from"])),
        valid_until=sp.timestamp(int(logical["valid_until"])),
        evidence_digest=sp.bytes("0x" + logical["evidence_digest"]),
        assets=assets,
    )


def assert_pack_equals(payload: Mapping[str, Any], packed_hex: str) -> None:
    scenario = sp.test_scenario(None, main)
    contract = main.Packer()
    scenario += contract
    contract.pack_payload(payload_to_sp(payload))
    scenario.verify(contract.data.packed == sp.bytes("0x" + packed_hex))


def assert_signature_verifies(packed_hex: str, public_key: str, signature: str) -> None:
    scenario = sp.test_scenario(None, main)
    contract = main.Packer()
    scenario += contract
    contract.check_sig(
        packed=sp.bytes("0x" + packed_hex),
        public_key=sp.key(public_key),
        signature=sp.signature(signature),
    )
