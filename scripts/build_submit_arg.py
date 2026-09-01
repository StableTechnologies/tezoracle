#!/usr/bin/env python3
"""Build the Michelson --arg for the `submit` entrypoint from a signed payload.

Input is the JSON printed by `npm run validator -- sign --candidate ... --output
signed.json`. Prints a value ready for:

  octez-client transfer 0 from <admin> to <contract> \\
    --entrypoint submit --arg "$(python scripts/build_submit_arg.py signed.json)"

1-of-1 only: wraps a single (index=0) signature. Testnet/shadow use only.
"""

from __future__ import annotations

import argparse
import json
import sys


def _asset_list_mich(assets: list[dict]) -> str:
    parts = [
        f'Pair "{a["asset_id"]}" (Pair {a["price"]} (Pair {a["decimals"]} {a["observation_time"]}))'
        for a in assets
    ]
    return "{ " + " ; ".join(parts) + " }"


def payload_mich(payload: dict) -> str:
    return (
        f'Pair "{payload["domain"]}" (Pair "{payload["chain_id"]}" (Pair "{payload["oracle_address"]}" '
        f'(Pair {payload["config_version"]} (Pair 0x{payload["policy_hash"]} '
        f'(Pair "{payload["publication_group"]}" (Pair {payload["round"]} '
        f'(Pair {payload["valid_from"]} (Pair {payload["valid_until"]} '
        f'(Pair 0x{payload["evidence_digest"]} {_asset_list_mich(payload["assets"])}'
        f")))))))))"
    )


def submit_arg(payload: dict, edsig: str, index: int = 0) -> str:
    return f'Pair ({payload_mich(payload)}) {{ Pair {index} "{edsig}" }}'


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("signed_json", help="path to `validator sign` output JSON")
    parser.add_argument("--index", type=int, default=0, help="signer index (default 0 for 1-of-1)")
    args = parser.parse_args()

    with open(args.signed_json, "r", encoding="utf-8") as fh:
        signed = json.load(fh)
    if not signed.get("ok", True):
        print(f"signed JSON reports failure: {signed}", file=sys.stderr)
        return 2

    print(submit_arg(signed["payload"], signed["signature"]["edsig"], args.index))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
