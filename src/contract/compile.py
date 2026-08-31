"""Compile TezOracle to Michelson. Testnet keys only; never production secrets."""

from __future__ import annotations

import re
from pathlib import Path

import smartpy as sp

from contract.oracle import main as oracle_main

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "michelson" / "tezoracle.tz"
PRICE_NAT_MAX = (1 << 96) - 1


def strip_stack_comments(src: str) -> str:
    """Drop SmartPy stack-annotation comments. Semantics are unchanged."""
    lines: list[str] = []
    for line in src.splitlines():
        if "#" in line:
            line = line.split("#", 1)[0]
        line = line.rstrip()
        if line.strip():
            lines.append(line)
    return "\n".join(lines) + "\n"


_SOURCE_FAILWITH = re.compile(
    r"^([ \t]*)PUSH int [1-9][0-9]+;\n([ \t]*)FAILWITH;",
    re.MULTILINE,
)


def normalize_source_locations(src: str) -> str:
    """Ignore SmartPy source-line FAILWITH payloads.

    Unlabeled ``GET`` / map misses compile to ``PUSH int <lineno>; FAILWITH``.
    Those integers track ``oracle.py`` line numbers and move when the file
    is edited or compiled under another Python/SmartPy pair. They are not
    part of the on-chain interface.
    """
    return _SOURCE_FAILWITH.sub(r"\1PUSH int 0;\n\2FAILWITH;", src)


def _policy():
    return sp.record(
        decimals=6,
        max_observation_age_seconds=120,
        absolute_min_price=1,
        absolute_max_price=PRICE_NAT_MAX,
        max_movement_bps=10000,
    )


def compile_tezoracle() -> dict:
    scenario = sp.test_scenario(None, oracle_main)
    admin = sp.test_account("compile-admin")
    signer = sp.test_account("compile-signer")
    init = sp.record(
        admin=admin.address,
        guardian=admin.address,
        config_version=1,
        policy_hash=sp.bytes("0x" + "11" * 32),
        threshold_n=1,
        threshold_m=1,
        activation_delay_levels=1,
        min_activation_delay_levels=1,
        max_clock_skew_seconds=5,
        validity_window_seconds=180,
        price_nat_max=PRICE_NAT_MAX,
        signers={
            0: sp.record(public_key=signer.public_key, class_id="A", active=True)
        },
        class_minima={},
        groups={"CORE": ["XTZ_USD"]},
        assets={"XTZ_USD": _policy()},
    )
    contract = oracle_main.TezOracle(init)
    scenario += contract
    result = contract.origination_result
    code = strip_stack_comments(result["code_tz"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(code)
    return {
        "path": str(OUT),
        "bytes": len(code.encode()),
        "code_size": result.get("code_size"),
        "errors": result.get("errors"),
        "storage_tz": result.get("storage_tz"),
    }


def _cli() -> None:
    info = compile_tezoracle()
    print(f"wrote {info['path']} ({info['bytes']} bytes)")
    if info["code_size"] is not None:
        print(f"compiler code_size={info['code_size']}")
    print(f"compiler errors: {info['errors']!r}")
    print("initial storage (dummy compile keys, not for production):")
    print(info["storage_tz"])


if __name__ == "__main__":
    _cli()
