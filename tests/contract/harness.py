"""Shared SmartPy harness for the N-of-M TezOracle contract."""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

import smartpy as sp

from contract.oracle import main

CHAIN_HEX = "0xaf1864d9"
DOMAIN = "TEZORACLE_V1"
POLICY_HASH = "11" * 32
EVIDENCE_DIGEST = "22" * 32
PRICE_NAT_MAX = (1 << 96) - 1

NOW = 1_800_000_000
OBS = NOW - 30
VALID_FROM = NOW - 10
VALID_UNTIL = NOW + 60
SUBMIT_LEVEL = 100
DELAY = 1

CORE_PRICES = {
    "BTC_USD": 65_000_000_000,
    "USDT_USD": 1_000_100,
    "XTZ_USD": 750_000,
}
CORE_OBS = {
    "BTC_USD": OBS,
    "USDT_USD": OBS + 5,
    "XTZ_USD": OBS - 5,
}


def chain_id():
    return sp.chain_id_cst(CHAIN_HEX)


def policy_bytes():
    return sp.bytes("0x" + POLICY_HASH)


def evidence_bytes():
    return sp.bytes("0x" + EVIDENCE_DIGEST)


def asset_policy(
    decimals: int = 6,
    max_age: int = 120,
    abs_min: int = 1,
    abs_max: int = PRICE_NAT_MAX,
    max_movement_bps: int = 10_000,
):
    return sp.record(
        decimals=decimals,
        max_observation_age_seconds=max_age,
        absolute_min_price=abs_min,
        absolute_max_price=abs_max,
        max_movement_bps=max_movement_bps,
    )


def default_assets():
    return {
        "BTC_USD": asset_policy(abs_min=1_000_000_000, abs_max=500_000_000_000),
        "USDT_USD": asset_policy(abs_min=900_000, abs_max=1_100_000, max_movement_bps=300),
        "XTZ_USD": asset_policy(abs_min=10_000, abs_max=100_000_000),
        "USDTZ_USD": asset_policy(abs_min=900_000, abs_max=1_100_000),
        "TZBTC_USD": asset_policy(abs_min=1_000_000_000, abs_max=500_000_000_000),
    }


def default_groups():
    return {
        "CORE": ["BTC_USD", "USDT_USD", "XTZ_USD"],
        "USDTZ": ["USDTZ_USD"],
        "TZBTC": ["TZBTC_USD"],
    }


def signer_record(account, class_id: str = "A", active: bool = True):
    return sp.record(public_key=account.public_key, class_id=class_id, active=active)


def make_init(
    admin,
    guardian,
    accounts: Sequence[Any],
    n: int,
    class_ids: Sequence[str] | None = None,
    class_minima: Mapping[str, int] | None = None,
    delay: int = DELAY,
    config_version: int = 1,
    policy_hash=None,
    extra: Mapping[str, Any] | None = None,
):
    if class_ids is None:
        class_ids = ["A"] * len(accounts)
    signers = {
        i: signer_record(accounts[i], class_ids[i]) for i in range(len(accounts))
    }
    minima = class_minima if class_minima is not None else {}
    init = {
        "admin": admin,
        "guardian": guardian,
        "config_version": config_version,
        "policy_hash": policy_hash if policy_hash is not None else policy_bytes(),
        "threshold_n": n,
        "threshold_m": len(accounts),
        "activation_delay_levels": delay,
        "min_activation_delay_levels": 1,
        "max_clock_skew_seconds": 5,
        "validity_window_seconds": 180,
        "price_nat_max": PRICE_NAT_MAX,
        "signers": signers,
        "class_minima": minima,
        "groups": default_groups(),
        "assets": default_assets(),
    }
    if extra:
        init.update(extra)
    return sp.record(**init)


def originate(
    n: int,
    m: int,
    class_ids: Sequence[str] | None = None,
    class_minima: Mapping[str, int] | None = None,
    delay: int = DELAY,
    seed_prefix: str = "signer",
):
    scenario = sp.test_scenario(None, main)
    admin = sp.test_account("admin")
    guardian = sp.test_account("guardian")
    accounts = [sp.test_account(f"{seed_prefix}{i}") for i in range(m)]
    contract = main.TezOracle(
        make_init(
            admin.address,
            guardian.address,
            accounts,
            n,
            class_ids=class_ids,
            class_minima=class_minima,
            delay=delay,
        )
    )
    scenario += contract
    packer = main.Packer()
    scenario += packer
    return scenario, contract, packer, admin, guardian, accounts


def originate_1of1(**kwargs):
    return originate(1, 1, **kwargs)


def core_assets(
    prices: Mapping[str, int] | None = None,
    obs: Mapping[str, int] | None = None,
):
    prices = prices or CORE_PRICES
    obs = obs or CORE_OBS
    return [
        sp.record(
            asset_id=asset_id,
            price=prices[asset_id],
            decimals=6,
            observation_time=sp.timestamp(obs[asset_id]),
        )
        for asset_id in ("BTC_USD", "USDT_USD", "XTZ_USD")
    ]


def make_payload(
    oracle_address,
    round_n: int = 1,
    group: str = "CORE",
    assets=None,
    config_version: int = 1,
    policy_hash=None,
    chain=None,
    domain: str = DOMAIN,
    valid_from: int = VALID_FROM,
    valid_until: int = VALID_UNTIL,
    evidence=None,
):
    if assets is None:
        assets = core_assets()
    return sp.record(
        domain=domain,
        chain_id=chain if chain is not None else chain_id(),
        oracle_address=oracle_address,
        config_version=config_version,
        policy_hash=policy_hash if policy_hash is not None else policy_bytes(),
        publication_group=group,
        round=round_n,
        valid_from=sp.timestamp(valid_from),
        valid_until=sp.timestamp(valid_until),
        evidence_digest=evidence if evidence is not None else evidence_bytes(),
        assets=assets,
    )


def pack_payload(packer, payload):
    packer.pack_payload(payload)
    return packer.data.packed


def sign_indices(accounts, packed, indices: Iterable[int]):
    return [
        sp.record(
            index=i,
            signature=sp.make_signature(
                secret_key=accounts[i].secret_key,
                message=packed,
                message_format="Raw",
            ),
        )
        for i in indices
    ]


def submit(
    contract,
    packer,
    accounts,
    payload,
    indices: Sequence[int] | None = None,
    now: int = NOW,
    level: int = SUBMIT_LEVEL,
    chain=None,
    sender=None,
    valid: bool = True,
    exception: str | None = None,
):
    if indices is None:
        indices = list(range(len(accounts)))
        # N-of-M tests pass explicit indices; default signs all originated signers.
    packed = pack_payload(packer, payload)
    signatures = sign_indices(accounts, packed, indices)
    kwargs: dict[str, Any] = {
        "payload": payload,
        "signatures": signatures,
        "_now": sp.timestamp(now),
        "_level": level,
        "_chain_id": chain if chain is not None else chain_id(),
        "_valid": valid,
    }
    if sender is not None:
        kwargs["_sender"] = sender
    if exception is not None:
        kwargs["_exception"] = exception
    contract.submit(**kwargs)
    return signatures


def read_price(scenario, contract, asset_id: str, level: int, now: int = NOW):
    return scenario.compute(
        contract.get_price(asset_id),
        level=level,
        now=sp.timestamp(now),
        chain_id=chain_id(),
    )


def ctx(level: int, now: int = NOW, sender=None):
    kwargs: dict[str, Any] = {
        "_now": sp.timestamp(now),
        "_level": level,
        "_chain_id": chain_id(),
    }
    if sender is not None:
        kwargs["_sender"] = sender
    return kwargs
