"""Behavioral harness for the configurable N-of-M TezOracle contract."""

from __future__ import annotations

import pytest
from smartpy.public.exceptions import FailwithException, RuntimeException

from tests.contract.harness import (
    CORE_OBS,
    CORE_PRICES,
    DELAY,
    NOW,
    SUBMIT_LEVEL,
    chain_id,
    ctx,
    make_init,
    make_payload,
    originate,
    originate_1of1,
    pack_payload,
    read_price,
    sign_indices,
    submit,
)
import smartpy as sp


def _fail_view(scenario, contract, asset_id, level, substring):
    with pytest.raises((FailwithException, RuntimeException)) as exc:
        scenario.compute(
            contract.get_price(asset_id),
            level=level,
            now=sp.timestamp(NOW),
            chain_id=chain_id(),
        )
    assert substring in str(exc.value)


def test_valid_quorum_1_of_1_pending_then_active():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    payload = make_payload(c.address)
    submit(c, packer, accounts, payload, indices=[0], level=SUBMIT_LEVEL)
    sc.verify(c.data.last_round["CORE"] == 1)
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL, "NO_PRICE")
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])
    sc.verify(quote.observation_time == sp.timestamp(CORE_OBS["XTZ_USD"]))
    alias = sc.compute(
        c.get_price_with_timestamp("XTZ_USD"),
        level=SUBMIT_LEVEL + DELAY,
        now=sp.timestamp(NOW),
        chain_id=chain_id(),
    )
    sc.verify(alias.price == CORE_PRICES["XTZ_USD"])
    sc.verify(alias.observation_time == sp.timestamp(CORE_OBS["XTZ_USD"]))


def test_insufficient_quorum():
    sc, c, packer, _admin, _guardian, accounts = originate(
        3, 4, class_ids=["A", "A", "B", "B"], class_minima={"A": 1, "B": 1}
    )
    payload = make_payload(c.address)
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1],
        valid=False,
        exception="QUORUM",
    )


def test_unauthorized_signer():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    outsider = sp.test_account("outsider")
    payload = make_payload(c.address)
    packed = pack_payload(packer, payload)
    bad = [
        sp.record(
            index=0,
            signature=sp.make_signature(
                secret_key=outsider.secret_key,
                message=packed,
                message_format="Raw",
            ),
        )
    ]
    c.submit(
        payload=payload,
        signatures=bad,
        _valid=False,
        _exception="SIGNATURE",
        **ctx(SUBMIT_LEVEL),
    )


def test_duplicate_signature():
    sc, c, packer, _admin, _guardian, accounts = originate(
        1, 2, class_ids=["A", "A"]
    )
    payload = make_payload(c.address)
    packed = pack_payload(packer, payload)
    sig = sign_indices(accounts, packed, [0])[0]
    c.submit(
        payload=payload,
        signatures=[sig, sp.record(index=0, signature=sig.signature)],
        _valid=False,
        _exception="DUPLICATE",
        **ctx(SUBMIT_LEVEL),
    )


def test_unknown_signer_index():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    payload = make_payload(c.address)
    packed = pack_payload(packer, payload)
    sig0 = sign_indices(accounts, packed, [0])[0]
    c.submit(
        payload=payload,
        signatures=[sp.record(index=9, signature=sig0.signature)],
        _valid=False,
        _exception="UNKNOWN_SIGNER",
        **ctx(SUBMIT_LEVEL),
    )


def test_replay_same_round():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    payload = make_payload(c.address, round_n=1)
    submit(c, packer, accounts, payload, indices=[0])
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0],
        valid=False,
        exception="ROUND",
        level=SUBMIT_LEVEL + 1,
    )


def test_monotonic_round_skip_allowed():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=4),
        indices=[0],
        level=SUBMIT_LEVEL + 1,
        now=NOW + 1,
        valid=True,
    )
    sc.verify(c.data.last_round["CORE"] == 4)


def test_wrong_domain():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    payload = make_payload(c.address, domain="TEZFIN_ORACLE_V1")
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0],
        valid=False,
        exception="DOMAIN",
    )


def test_wrong_chain():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    payload = make_payload(c.address, chain=sp.chain_id_cst("0x7a06a770"))
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0],
        valid=False,
        exception="CHAIN",
        chain=chain_id(),
    )


def test_wrong_oracle_address():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    other = sp.address("KT1Mpqi89gRyUuoXUPAWjHkqkk1F48eUKUVy")
    payload = make_payload(other)
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0],
        valid=False,
        exception="ORACLE",
    )


def test_wrong_config_and_policy():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, config_version=2),
        indices=[0],
        valid=False,
        exception="CONFIG",
    )
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, policy_hash=sp.bytes("0x" + "ab" * 32)),
        indices=[0],
        valid=False,
        exception="POLICY",
        level=SUBMIT_LEVEL + 1,
    )


def test_stale_and_future_observation():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    stale = dict(CORE_OBS)
    stale["XTZ_USD"] = NOW - 121
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, assets=_assets_with_obs(stale)),
        indices=[0],
        valid=False,
        exception="OBS_STALE",
    )
    future = dict(CORE_OBS)
    future["XTZ_USD"] = NOW + 6
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, assets=_assets_with_obs(future)),
        indices=[0],
        valid=False,
        exception="OBS_FUTURE",
        level=SUBMIT_LEVEL + 1,
    )


def test_observation_regression():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    earlier = dict(CORE_OBS)
    earlier["XTZ_USD"] = CORE_OBS["XTZ_USD"] - 1
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2, assets=_assets_with_obs(earlier)),
        indices=[0],
        valid=False,
        exception="OBS_REGRESS",
        level=SUBMIT_LEVEL + 1,
        now=NOW + 1,
    )


def test_window_rejects_outside_and_too_long():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, valid_from=NOW + 1, valid_until=NOW + 10),
        indices=[0],
        valid=False,
        exception="WINDOW",
    )
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, valid_from=NOW - 200, valid_until=NOW + 1),
        indices=[0],
        valid=False,
        exception="WINDOW",
        level=SUBMIT_LEVEL + 1,
    )


def test_pause_blocks_submit_and_view_immediately():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    c.pause(**ctx(SUBMIT_LEVEL + DELAY, sender=guardian))
    sc.verify(c.data.paused)
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY, "PAUSED")
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        valid=False,
        exception="PAUSED",
        level=SUBMIT_LEVEL + DELAY + 1,
        now=NOW + 1,
    )


def test_delayed_unpause_before_and_after_activation():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    c.pause(**ctx(SUBMIT_LEVEL + 1, sender=admin))
    c.propose_unpause(**ctx(SUBMIT_LEVEL + 1, sender=admin))
    c.activate_unpause(
        _valid=False,
        _exception="DELAY",
        **ctx(SUBMIT_LEVEL + 1),
    )
    c.activate_unpause(**ctx(SUBMIT_LEVEL + 1 + DELAY))
    sc.verify(c.data.paused == False)
    # Pause quarantines pending quotes; restoration needs a fresh publication.
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + 1 + DELAY, "NO_PRICE")
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + 1 + DELAY,
        now=NOW + 1,
    )
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + 1 + DELAY + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_guardian_cannot_unpause_or_configure():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    c.propose_unpause(
        _valid=False,
        _exception="NOT_ADMIN",
        **ctx(SUBMIT_LEVEL, sender=guardian),
    )
    nxt = make_init(
        admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
        policy_hash=sp.bytes("0x" + "33" * 32),
    )
    c.propose_config(nxt, _valid=False, _exception="NOT_ADMIN", **ctx(SUBMIT_LEVEL, sender=guardian))


def test_delayed_config_before_and_after_activation():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    new_hash = sp.bytes("0x" + "33" * 32)
    nxt = make_init(
        admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
        policy_hash=new_hash,
    )
    c.propose_config(nxt, **ctx(SUBMIT_LEVEL, sender=admin))
    c.activate_config(_valid=False, _exception="DELAY", **ctx(SUBMIT_LEVEL))
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, policy_hash=new_hash, config_version=2),
        indices=[0],
        valid=False,
        exception="CONFIG",
        level=SUBMIT_LEVEL,
    )
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY))
    sc.verify(c.data.config_version == 2)
    sc.verify(c.data.policy_hash == new_hash)
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, config_version=1),
        indices=[0],
        valid=False,
        exception="CONFIG",
        level=SUBMIT_LEVEL + DELAY,
    )
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, config_version=2, policy_hash=new_hash),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
    )
    sc.verify(c.data.last_round["CORE"] == 1)


def test_cancel_pending_config():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    nxt = make_init(
        admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
        policy_hash=sp.bytes("0x" + "33" * 32),
    )
    c.propose_config(nxt, **ctx(SUBMIT_LEVEL, sender=admin))
    c.cancel_pending_config(**ctx(SUBMIT_LEVEL, sender=admin))
    c.activate_config(_valid=False, _exception="NO_PENDING", **ctx(SUBMIT_LEVEL + DELAY))
    sc.verify(c.data.config_version == 1)


def test_asset_pause_and_delayed_resume():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause_asset("XTZ_USD", **ctx(SUBMIT_LEVEL, sender=guardian))
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address),
        indices=[0],
        valid=False,
        exception="ASSET_PAUSED",
        level=SUBMIT_LEVEL,
    )
    c.propose_asset_unpause("XTZ_USD", **ctx(SUBMIT_LEVEL, sender=admin))
    c.activate_asset_unpause(
        "XTZ_USD", _valid=False, _exception="DELAY", **ctx(SUBMIT_LEVEL)
    )
    c.activate_asset_unpause("XTZ_USD", **ctx(SUBMIT_LEVEL + DELAY))
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
    )


def test_core_does_not_advance_tzbtc_round():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, group="CORE"), indices=[0])
    sc.verify(c.data.last_round["CORE"] == 1)
    _fail_view(sc, c, "TZBTC_USD", SUBMIT_LEVEL + DELAY, "NO_PRICE")


def test_bad_config_n_greater_than_m_fails_origination():
    with pytest.raises((FailwithException, RuntimeException, Exception)):
        originate(2, 1)


def _assets_with_obs(obs):
    return [
        sp.record(
            asset_id=asset_id,
            price=CORE_PRICES[asset_id],
            decimals=6,
            observation_time=sp.timestamp(obs[asset_id]),
        )
        for asset_id in ("BTC_USD", "USDT_USD", "XTZ_USD")
    ]
