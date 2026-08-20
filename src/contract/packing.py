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


def payload_to_sp(payload: Mapping[str, Any]) -> Any:
    canonical = parse_logical_payload(payload)
    assets = [
        sp.record(
            asset_id=asset["asset_id"],
            price=sp.nat(int(asset["price"])),
            decimals=sp.nat(int(asset["decimals"])),
            observation_time=sp.timestamp(int(asset["observation_time"])),
        )
        for asset in canonical["assets"]
    ]
    return sp.record(
        domain=canonical["domain"],
        chain_id=sp.chain_id_cst("0x" + chain_id_hex(canonical["chain_id"])),
        oracle_address=sp.address(canonical["oracle_address"]),
        config_version=sp.nat(int(canonical["config_version"])),
        policy_hash=sp.bytes("0x" + canonical["policy_hash"]),
        publication_group=canonical["publication_group"],
        round=sp.nat(int(canonical["round"])),
        valid_from=sp.timestamp(int(canonical["valid_from"])),
        valid_until=sp.timestamp(int(canonical["valid_until"])),
        evidence_digest=sp.bytes("0x" + canonical["evidence_digest"]),
        assets=assets,
    )


def assert_pack_equals(payload: Mapping[str, Any], packed_hex: str) -> None:
    scenario = sp.test_scenario(None, main)
    contract = main.Packer()
    scenario += contract
    contract.pack_payload(payload_to_sp(payload))
    scenario.verify(contract.data.packed == sp.bytes("0x" + packed_hex))
