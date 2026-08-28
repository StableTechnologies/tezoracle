#!/usr/bin/env python3
"""Forge TezOracle origination and submit against an octez Ushuaia mockup."""

from __future__ import annotations

import argparse
import json
import sys

from contract.octez_ops import ROOT, measure, octez_available, render_markdown

JSON_OUT = ROOT / "docs" / "octez_measurements.json"
MD_OUT = ROOT / "docs" / "OPERATION_MEASUREMENTS.md"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help=f"write {JSON_OUT.name} and {MD_OUT.name}",
    )
    args = parser.parse_args()
    if not octez_available():
        print("octez-client is not on PATH", file=sys.stderr)
        return 2
    report = measure()
    print(render_markdown(report))
    if args.write:
        JSON_OUT.write_text(json.dumps(report, indent=2) + "\n")
        MD_OUT.write_text(render_markdown(report))
        print(f"wrote {JSON_OUT}", file=sys.stderr)
        print(f"wrote {MD_OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
