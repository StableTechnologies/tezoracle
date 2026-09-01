#!/usr/bin/env python3
"""Build 1-of-1 origination storage from the pinned config/ register.

Prints policy_hash and Micheline `--init` storage for `octez-client
originate`. Uses the real committed register (groups, assets, time policy),
not the dummy compile/mockup fixtures. Testnet-only: pass a testnet admin
address and a testnet signer public key, never production keys.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import smartpy as sp

from contract.oracle import main
from contract.register import load_committed_register

PRICE_NAT_MAX_CAP = (1 << 96) - 1


def _asset_policy(asset: dict) -> object:
    return sp.record(
        decimals=int(asset["decimals"]),
        max_observation_age_seconds=int(asset["max_observation_age_seconds"]),
        absolute_min_price=int(asset["absolute_min_price"]),
        absolute_max_price=int(asset["absolute_max_price"]),
        max_movement_bps=int(asset["max_movement_bps"]),
    )


def build_storage_tz(
    *,
    admin: str,
    signer_pk: str,
    guardian: str | None,
    config_dir: Path | None,
) -> tuple[str, str]:
    snapshot, policy, policy_hash = load_committed_register(config_dir)
    register = snapshot["register"]
    time_policy = register["time_policy"]
    assets = {
        asset_id: _asset_policy(asset) for asset_id, asset in snapshot["assets"].items()
    }
    price_nat_max = min(policy.price_nat_max, PRICE_NAT_MAX_CAP)

    init = sp.record(
        admin=sp.address(admin),
        guardian=sp.address(guardian or admin),
        config_version=int(register["config_version"]),
        policy_hash=sp.bytes("0x" + policy_hash),
        threshold_n=1,
        threshold_m=1,
        activation_delay_levels=int(time_policy["activation_delay_levels"]),
        min_activation_delay_levels=int(time_policy["min_activation_delay_levels"]),
        max_clock_skew_seconds=int(time_policy["max_clock_skew_seconds"]),
        validity_window_seconds=int(time_policy["validity_window_seconds"]),
        price_nat_max=price_nat_max,
        signers={0: sp.record(public_key=sp.key(signer_pk), class_id="A", active=True)},
        class_minima={},
        groups=policy.groups,
        assets=assets,
    )
    scenario = sp.test_scenario(None, main)
    contract = main.TezOracle(init)
    scenario += contract
    storage = contract.origination_result["storage_tz"]
    return policy_hash, storage


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin", required=True, help="testnet tz1/tz2/tz3 admin address")
    parser.add_argument("--signer-pk", required=True, help="testnet edpk... Class A public key")
    parser.add_argument("--guardian", default=None, help="defaults to --admin")
    parser.add_argument("--config-dir", default=None, help="defaults to committed config/")
    args = parser.parse_args()

    if not args.admin.startswith(("tz1", "tz2", "tz3")):
        print("--admin must be a tz1/tz2/tz3 implicit address", file=sys.stderr)
        return 2
    if not args.signer_pk.startswith("edpk"):
        print("--signer-pk must be an edpk... Ed25519 public key", file=sys.stderr)
        return 2

    config_dir = Path(args.config_dir) if args.config_dir else None
    policy_hash, storage = build_storage_tz(
        admin=args.admin,
        signer_pk=args.signer_pk,
        guardian=args.guardian,
        config_dir=config_dir,
    )
    print(f"# policy_hash: {policy_hash}")
    print(storage)
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
