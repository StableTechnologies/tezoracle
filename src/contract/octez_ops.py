"""Forge and simulate TezOracle operations against an octez mockup.

Uses protocol Ushuaia (PsUshuai) and well-known mockup bootstrap keys plus
generated extra signers. Dummy data only — never production keys.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import smartpy as sp

from contract.oracle import main

ROOT = Path(__file__).resolve().parents[2]
MICHELSON = ROOT / "michelson" / "tezoracle.tz"
PROTOCOL = "PsUshuai9QapM5TGj1JpuVGkdxz5GykdnEvS6Rh8SUVrARvZLCY"
PROTOCOL_NAME = "Ushuaia"
OCTEZ_MAX_ANNOTATION = 31
PRICE_NAT_MAX = (1 << 96) - 1
POLICY_HASH = "11" * 32
EVIDENCE_DIGEST = "22" * 32
MAX_GROUP_SIZE = 8

BOOTSTRAP_EDPK = {
    "bootstrap1": "edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav",
    "bootstrap2": "edpktzNbDAUjUk697W7gYg2CRuBQjyPxbEg8dLccYYwKSKvkPvjtV9",
    "bootstrap3": "edpkuTXkJDGcFd5nh6VvMz8phXxU3Bi7h6hqgywNFi1vZTfQNnS1RV",
    "bootstrap4": "edpkuFrRoDSEbJYgxRtLx2ps82UdaYc1WwfS9sE11yhauZt5DgCHbU",
    "bootstrap5": "edpkv8EUUH68jmo3f7Um5PezmfGrRF24gnfLpH3sVNwJnV5bVCxL2n",
}
BOOTSTRAP1_TZ1 = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx"

PAYLOAD_TYPE = """
pair (string %domain)
     (pair (chain_id %chain_id)
           (pair (address %oracle_address)
                 (pair (nat %config_version)
                       (pair (bytes %policy_hash)
                             (pair (string %publication_group)
                                   (pair (nat %round)
                                         (pair (timestamp %valid_from)
                                               (pair (timestamp %valid_until)
                                                     (pair (bytes %evidence_digest)
                                                           (list %assets
                                                              (pair (string %asset_id)
                                                                    (pair (nat %price)
                                                                          (pair (nat %decimals)
                                                                                (timestamp %observation_time))))))))))))))
""".strip()

CORE_PRICES = {
    "BTC_USD": 65_000_000_000,
    "USDT_USD": 1_000_100,
    "XTZ_USD": 750_000,
}


@dataclass
class OpMetrics:
    name: str
    encoded_operation_bytes: int | None
    consumed_gas: int | None
    paid_storage_diff_bytes: int | None
    storage_size_bytes: int | None
    fee_tez: str | None
    burn_tez: str | None
    succeeded: bool
    notes: str = ""


class OctezError(RuntimeError):
    pass


def octez_available() -> bool:
    return shutil.which("octez-client") is not None


def _run(
    args: Sequence[str],
    *,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        list(args),
        check=False,
        text=True,
        capture_output=True,
    )
    if check and proc.returncode != 0:
        raise OctezError(
            f"{' '.join(args)}\n"
            f"exit {proc.returncode}\n"
            f"{proc.stdout[-4000:]}\n{proc.stderr[-4000:]}"
        )
    return proc


class Mockup:
    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir)
        self.protocol = PROTOCOL

    def cmd(self, *args: str) -> list[str]:
        return [
            "octez-client",
            "--mode",
            "mockup",
            "--base-dir",
            str(self.base_dir),
            "--protocol",
            self.protocol,
            *args,
        ]

    def run(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return _run(self.cmd(*args), check=check)

    def create(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        _run(
            [
                "octez-client",
                "--mode",
                "mockup",
                "--base-dir",
                str(self.base_dir),
                "--protocol",
                self.protocol,
                "create",
                "mockup",
            ]
        )

    def chain_id(self) -> str:
        out = self.run("rpc", "get", "/chains/main/chain_id").stdout.strip().strip('"')
        return out

    def constants(self) -> dict[str, Any]:
        raw = self.run(
            "rpc", "get", "/chains/main/blocks/head/context/constants"
        ).stdout
        return json.loads(raw)

    def gen_key(self, alias: str) -> tuple[str, str]:
        self.run("gen", "keys", alias)
        text = self.run("show", "address", alias).stdout
        tz1 = re.search(r"Hash:\s+(\S+)", text)
        pk = re.search(r"Public Key:\s+(\S+)", text)
        if not tz1 or not pk:
            raise OctezError(f"could not parse key {alias}: {text}")
        return tz1.group(1), pk.group(1)

    def show_contract(self, alias: str) -> str:
        return self.run("show", "known", "contract", alias).stdout.strip()


def _policy(
    abs_min: int = 1,
    abs_max: int = PRICE_NAT_MAX,
    max_movement_bps: int = 10_000,
):
    return sp.record(
        decimals=6,
        max_observation_age_seconds=120,
        absolute_min_price=abs_min,
        absolute_max_price=abs_max,
        max_movement_bps=max_movement_bps,
    )


def default_assets():
    return {
        "BTC_USD": _policy(abs_min=1_000_000_000, abs_max=500_000_000_000),
        "USDT_USD": _policy(abs_min=900_000, abs_max=1_100_000, max_movement_bps=300),
        "XTZ_USD": _policy(abs_min=10_000, abs_max=100_000_000),
        "USDTZ_USD": _policy(abs_min=900_000, abs_max=1_100_000),
        "TZBTC_USD": _policy(abs_min=1_000_000_000, abs_max=500_000_000_000),
    }


def default_groups():
    return {
        "CORE": ["BTC_USD", "USDT_USD", "XTZ_USD"],
        "USDTZ": ["USDTZ_USD"],
        "TZBTC": ["TZBTC_USD"],
    }


def max_group_assets():
    assets = {}
    ids = []
    for i in range(MAX_GROUP_SIZE):
        aid = f"A{i}_USD"
        ids.append(aid)
        assets[aid] = _policy()
    return assets, {"MAX": ids}


class _PkAccount:
    def __init__(self, edpk: str):
        self.public_key = sp.key(edpk)


def storage_tz(
    *,
    n: int,
    public_keys: Sequence[str],
    class_ids: Sequence[str] | None = None,
    class_minima: Mapping[str, int] | None = None,
    assets=None,
    groups=None,
    admin: str = BOOTSTRAP1_TZ1,
) -> str:
    if class_ids is None:
        class_ids = ["A"] * len(public_keys)
    accounts = [_PkAccount(pk) for pk in public_keys]
    signers = {
        i: sp.record(public_key=accounts[i].public_key, class_id=class_ids[i], active=True)
        for i in range(len(accounts))
    }
    init = sp.record(
        admin=sp.address(admin),
        guardian=sp.address(admin),
        config_version=1,
        policy_hash=sp.bytes("0x" + POLICY_HASH),
        threshold_n=n,
        threshold_m=len(public_keys),
        activation_delay_levels=1,
        min_activation_delay_levels=1,
        max_clock_skew_seconds=5,
        validity_window_seconds=180,
        price_nat_max=PRICE_NAT_MAX,
        signers=signers,
        class_minima=class_minima or {},
        groups=groups if groups is not None else default_groups(),
        assets=assets if assets is not None else default_assets(),
    )
    scenario = sp.test_scenario(None, main)
    contract = main.TezOracle(init)
    scenario += contract
    return contract.origination_result["storage_tz"]


def _parse_number(pattern: str, text: str) -> int | None:
    m = re.search(pattern, text)
    if not m:
        return None
    return int(round(float(m.group(1).replace("_", "").replace(",", ""))))


def _parse_operation_bytes(text: str) -> int | None:
    m = re.search(
        r"\* Operation bytes:\s*\n((?:[ \t]*[0-9a-fA-F]+\n)+)",
        text,
    )
    if not m:
        return None
    hexdata = re.sub(r"\s+", "", m.group(1))
    if len(hexdata) % 2:
        return None
    return len(hexdata) // 2


def parse_metrics(name: str, text: str) -> OpMetrics:
    encoded = _parse_operation_bytes(text)
    fee = re.search(r"Fee to the baker:\s*ꜩ([0-9.]+)", text)
    burns = [float(x) for x in re.findall(r"storage fees[ .]*\+ꜩ([0-9.]+)", text)]
    burn = f"{sum(burns):.6f}".rstrip("0").rstrip(".") if burns else None
    succeeded = (
        "successfully applied" in text.lower()
        or "this origination was successfully applied" in text.lower()
        or "this transaction was successfully applied" in text.lower()
    )
    notes = ""
    fail = re.search(r'"id":\s*"([^"]+)"', text)
    if fail and not succeeded:
        notes = fail.group(1)
    if not succeeded:
        str_fail = re.search(r"Fatal error:\s*(.+)", text)
        if str_fail:
            notes = str_fail.group(1).strip()[:300]
    gas = _parse_number(r"Consumed gas:\s*([0-9_]+(?:\.[0-9]+)?)", text)
    if gas is None:
        gas = _parse_number(
            r"Estimated gas:\s*([0-9_]+(?:\.[0-9]+)?)\s*units", text
        )
    return OpMetrics(
        name=name,
        encoded_operation_bytes=encoded,
        consumed_gas=gas,
        paid_storage_diff_bytes=_parse_number(
            r"Paid storage size diff:\s*([0-9_]+) bytes", text
        ),
        storage_size_bytes=_parse_number(r"Storage size:\s*([0-9_]+) bytes", text),
        fee_tez=fee.group(1) if fee else None,
        burn_tez=burn,
        succeeded=succeeded,
        notes=notes,
    )


def encoded_script_bytes(mockup: Mockup, script: Path) -> int | None:
    proc = mockup.run(
        "convert",
        "script",
        str(script),
        "from",
        "michelson",
        "to",
        "binary",
        check=False,
    )
    text = proc.stdout + proc.stderr
    m = re.search(r"0x([0-9a-fA-F]+)", text)
    if m:
        return len(m.group(1)) // 2
    return None


def originate(
    mockup: Mockup,
    alias: str,
    storage: str,
    *,
    dry_run: bool = False,
) -> tuple[OpMetrics, str]:
    args = [
        "originate",
        "contract",
        alias,
        "transferring",
        "0",
        "from",
        "bootstrap1",
        "running",
        str(MICHELSON),
        "--init",
        storage,
        "--burn-cap",
        "20",
        "--fee-cap",
        "2",
        "--verbose-signing",
        "--no-print-source",
        "--force",
    ]
    if dry_run:
        args.append("--dry-run")
    proc = mockup.run(*args, check=False)
    text = proc.stdout + "\n" + proc.stderr
    metrics = parse_metrics(f"originate:{alias}", text)
    if proc.returncode != 0 and not metrics.succeeded:
        metrics.succeeded = False
        if not metrics.notes:
            metrics.notes = text[-800:]
        return metrics, text
    return metrics, text


def _asset_list_mich(assets: Sequence[tuple[str, int]]) -> str:
    parts = []
    for aid, price in assets:
        parts.append(f'Pair "{aid}" (Pair {price} (Pair 6 1))')
    return "{ " + " ; ".join(parts) + " }"


def payload_michelson(
    *,
    chain_id: str,
    oracle: str,
    group: str,
    assets: Sequence[tuple[str, int]],
    round_n: int = 1,
) -> str:
    return (
        f'Pair "TEZORACLE_V1" (Pair "{chain_id}" (Pair "{oracle}" '
        f'(Pair 1 (Pair 0x{POLICY_HASH} (Pair "{group}" (Pair {round_n} '
        f"(Pair 0 (Pair 60 (Pair 0x{EVIDENCE_DIGEST} "
        f"{_asset_list_mich(assets)})))))))))"
    )


def pack_payload(mockup: Mockup, payload_mich: str) -> str:
    data_file = mockup.base_dir / "payload.tz"
    type_file = mockup.base_dir / "payload_type.tz"
    data_file.write_text(payload_mich)
    type_file.write_text(PAYLOAD_TYPE)
    proc = mockup.run(
        "hash",
        "data",
        f"file:{data_file}",
        "of",
        "type",
        f"file:{type_file}",
    )
    m = re.search(r"Raw packed data:\s*(0x[0-9a-fA-F]+)", proc.stdout)
    if not m:
        raise OctezError(f"pack failed:\n{proc.stdout}\n{proc.stderr}")
    return m.group(1)


def sign_bytes(mockup: Mockup, packed: str, alias: str) -> str:
    proc = mockup.run("sign", "bytes", packed, "for", alias)
    m = re.search(r"Signature:\s+(\S+)", proc.stdout)
    if not m:
        raise OctezError(f"sign failed for {alias}:\n{proc.stdout}")
    return m.group(1)


def submit_arg(payload_mich: str, signatures: Sequence[tuple[int, str]]) -> str:
    sigs = " ; ".join(f"Pair {idx} \"{sig}\"" for idx, sig in signatures)
    return f"Pair ({payload_mich}) {{ {sigs} }}"


def submit(
    mockup: Mockup,
    *,
    contract: str,
    payload_mich: str,
    signer_aliases: Sequence[str],
) -> tuple[OpMetrics, str]:
    packed = pack_payload(mockup, payload_mich)
    signed = [
        (i, sign_bytes(mockup, packed, alias))
        for i, alias in enumerate(signer_aliases)
    ]
    arg = submit_arg(payload_mich, signed)
    proc = mockup.run(
        "transfer",
        "0",
        "from",
        "bootstrap1",
        "to",
        contract,
        "--entrypoint",
        "submit",
        "--arg",
        arg,
        "--burn-cap",
        "5",
        "--fee-cap",
        "2",
        "--verbose-signing",
        "--no-print-source",
        check=False,
    )
    text = proc.stdout + "\n" + proc.stderr
    metrics = parse_metrics(f"submit:{contract}", text)
    if proc.returncode != 0 and not metrics.succeeded:
        metrics.succeeded = False
        if not metrics.notes:
            metrics.notes = text[-800:]
    return metrics, text


def core_asset_entries() -> list[tuple[str, int]]:
    return [
        ("BTC_USD", CORE_PRICES["BTC_USD"]),
        ("USDT_USD", CORE_PRICES["USDT_USD"]),
        ("XTZ_USD", CORE_PRICES["XTZ_USD"]),
    ]


def max_group_entries() -> list[tuple[str, int]]:
    return [(f"A{i}_USD", 1_000_000) for i in range(MAX_GROUP_SIZE)]


def measure(base_dir: Path | None = None) -> dict[str, Any]:
    if not octez_available():
        raise OctezError("octez-client is not on PATH")
    if not MICHELSON.exists():
        raise OctezError(f"missing {MICHELSON}; compile first")

    cleanup = False
    tmp = None
    if base_dir is None:
        tmp = tempfile.TemporaryDirectory(prefix="tezoracle-mockup-")
        base_dir = Path(tmp.name)
        cleanup = True
    elif base_dir.exists():
        shutil.rmtree(base_dir)

    try:
        return _measure_in(base_dir)
    finally:
        if cleanup and tmp is not None:
            tmp.cleanup()


def _measure_in(base_dir: Path) -> dict[str, Any]:
    mockup = Mockup(base_dir)
    mockup.create()
    chain = mockup.chain_id()
    constants = mockup.constants()
    _tz6, pk6 = mockup.gen_key("signer6")
    _tz7, pk7 = mockup.gen_key("signer7")
    del _tz6, _tz7

    bootstrap_pks = [BOOTSTRAP_EDPK[f"bootstrap{i}"] for i in range(1, 6)]
    pk_3of4 = bootstrap_pks[:4]
    pk_5of7 = bootstrap_pks + [pk6, pk7]
    aliases_3of4 = [f"bootstrap{i}" for i in range(1, 4)]  # N=3
    aliases_5of7 = [f"bootstrap{i}" for i in range(1, 6)]  # N=5

    michelson_text = MICHELSON.read_bytes()
    script_bin = encoded_script_bytes(mockup, MICHELSON)

    ops: list[OpMetrics] = []

    storage_3 = storage_tz(
        n=3,
        public_keys=pk_3of4,
        class_ids=["A", "A", "B", "B"],
        class_minima={"A": 1, "B": 1},
    )
    m3, t3 = originate(mockup, "tezoracle_3of4", storage_3)
    ops.append(m3)
    if not m3.succeeded:
        raise OctezError(f"3-of-4 origination failed: {m3.notes}\n{t3[-2000:]}")
    addr_3 = mockup.show_contract("tezoracle_3of4")

    payload_3 = payload_michelson(
        chain_id=chain, oracle=addr_3, group="CORE", assets=core_asset_entries()
    )
    s3, st3 = submit(
        mockup, contract="tezoracle_3of4", payload_mich=payload_3, signer_aliases=aliases_3of4
    )
    ops.append(s3)
    if not s3.succeeded:
        raise OctezError(f"3-of-4 submit failed: {s3.notes}\n{st3[-2000:]}")

    storage_5 = storage_tz(
        n=5,
        public_keys=pk_5of7,
        class_ids=["A"] * 7,
    )
    m5, t5 = originate(mockup, "tezoracle_5of7", storage_5)
    ops.append(m5)
    if not m5.succeeded:
        raise OctezError(f"5-of-7 origination failed: {m5.notes}\n{t5[-2000:]}")
    addr_5 = mockup.show_contract("tezoracle_5of7")

    payload_5 = payload_michelson(
        chain_id=chain, oracle=addr_5, group="CORE", assets=core_asset_entries()
    )
    s5, st5 = submit(
        mockup, contract="tezoracle_5of7", payload_mich=payload_5, signer_aliases=aliases_5of7
    )
    ops.append(s5)
    if not s5.succeeded:
        raise OctezError(f"5-of-7 CORE submit failed: {s5.notes}\n{st5[-2000:]}")

    max_assets, max_groups = max_group_assets()
    storage_max = storage_tz(
        n=5,
        public_keys=pk_5of7,
        class_ids=["A"] * 7,
        assets=max_assets,
        groups=max_groups,
    )
    mm, tm = originate(mockup, "tezoracle_5of7_maxgroup", storage_max)
    ops.append(mm)
    if not mm.succeeded:
        raise OctezError(f"5-of-7 max-group origination failed: {mm.notes}\n{tm[-2000:]}")
    addr_max = mockup.show_contract("tezoracle_5of7_maxgroup")
    payload_max = payload_michelson(
        chain_id=chain,
        oracle=addr_max,
        group="MAX",
        assets=max_group_entries(),
    )
    sm, stm = submit(
        mockup,
        contract="tezoracle_5of7_maxgroup",
        payload_mich=payload_max,
        signer_aliases=aliases_5of7,
    )
    ops.append(sm)
    if not sm.succeeded:
        raise OctezError(f"5-of-7 max-group submit failed: {sm.notes}\n{stm[-2000:]}")

    report = {
        "protocol": PROTOCOL,
        "protocol_name": PROTOCOL_NAME,
        "octez_client": _run(["octez-client", "--version"]).stdout.strip(),
        "chain_id": chain,
        "michelson_text_bytes": len(michelson_text),
        "encoded_script_bytes": script_bin,
        "hard_gas_limit_per_operation": int(
            constants.get("hard_gas_limit_per_operation", "1040000")
        ),
        "max_operation_data_length": int(
            constants.get("max_operation_data_length", 32768)
        ),
        "maximum_tested_publication_group_size": MAX_GROUP_SIZE,
        "operations": [asdict(op) for op in ops],
        "contracts": {
            "3-of-4": addr_3,
            "5-of-7": addr_5,
            "5-of-7-max-group": addr_max,
        },
    }
    return report


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Encoded operation size and gas",
        "",
        "Measured with `octez-client --mode mockup` against protocol "
        f"**{report['protocol_name']}** (`{report['protocol']}`).",
        "Bootstrap and generated keys only. Not a live-network origination.",
        "",
        "Michelson **text** size is not the encoded origination size. "
        "Ushuaia `max_operation_data_length` is 32768 bytes.",
        "",
        f"- octez-client: `{report['octez_client']}`",
        f"- mockup chain_id: `{report['chain_id']}`",
        f"- Michelson **text** size: {report['michelson_text_bytes']} bytes",
        f"- encoded **script** size: {report['encoded_script_bytes']} bytes",
        f"- `max_operation_data_length`: {report['max_operation_data_length']}",
        f"- `hard_gas_limit_per_operation`: {report['hard_gas_limit_per_operation']}",
        f"- maximum tested publication-group size: {report['maximum_tested_publication_group_size']}",
        "",
        "| Operation | Encoded op (bytes) | Gas | Storage burn (bytes) | Storage size | Fee (ꜩ) | Burn (ꜩ) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for op in report["operations"]:
        lines.append(
            "| {name} | {enc} | {gas} | {diff} | {ss} | {fee} | {burn} |".format(
                name=op["name"],
                enc=op["encoded_operation_bytes"],
                gas=op["consumed_gas"],
                diff=op["paid_storage_diff_bytes"],
                ss=op["storage_size_bytes"],
                fee=op["fee_tez"],
                burn=op["burn_tez"],
            )
        )
    lines.extend(
        [
            "",
            "Re-run: `PYTHONPATH=src python scripts/measure_octez_ops.py`.",
            "",
        ]
    )
    return "\n".join(lines)
