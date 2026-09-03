"""Regression tests for reviewer state-transition issues 1–6 and 9.

Coverage map:

- pause with immature / mature pending
- per-asset pause with a pending quote (immature and mature)
- configuration activation with active and pending quotes
- decimals, bounds, signer, and policy changes
- pending unpause during governance rotation (global and per-asset)
- repeated publication faster than the activation delay
- automatic movement-limit rejection, persist, and emitted event
- distinct unpause / config / movement events
- configured size caps
"""

from __future__ import annotations

import pytest
from smartpy.public.exceptions import FailwithException, RuntimeException

import smartpy as sp

from tests.contract.harness import (
    CORE_PRICES,
    DELAY,
    NOW,
    SUBMIT_LEVEL,
    asset_policy,
    chain_id,
    core_assets,
    ctx,
    default_assets,
    default_groups,
    last_event_tags,
    last_events,
    make_init,
    make_payload,
    originate,
    originate_1of1,
    propose_asset_unpause,
    propose_config,
    propose_unpause,
    cancel_asset_unpause,
    cancel_pending_config,
    cancel_pending_unpause,
    read_price,
    submit,
)


def _fail_view(scenario, contract, asset_id, level, substring):
    with pytest.raises((FailwithException, RuntimeException)) as exc:
        scenario.compute(
            contract.get_price(asset_id),
            level=level,
            now=sp.timestamp(NOW),
            chain_id=chain_id(),
        )
    assert substring in str(exc.value)


def _next_init(admin, guardian, accounts, **kwargs):
    extra = kwargs.pop("extra", None)
    return make_init(
        admin.address,
        guardian.address,
        accounts,
        1,
        config_version=kwargs.pop("config_version", 2),
        extra=extra,
        **kwargs,
    )


def test_pause_does_not_promote_immature_pending():
    sc, c, packer, _admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    sc.verify(c.data.paused)
    sc.verify(c.data.last_global_pause_level == SUBMIT_LEVEL)
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    assert last_event_tags(sc) == ["tezoracle_pause"]
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL, "PAUSED")
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY, "PAUSED")


def test_pause_does_not_promote_mature_pending():
    sc, c, packer, _admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])
    c.pause(**ctx(SUBMIT_LEVEL + DELAY, sender=guardian))
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY, "PAUSED")


def test_pause_asset_discards_immature_pending_without_promoting():
    sc, c, packer, _admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    c.pause_asset("XTZ_USD", **ctx(SUBMIT_LEVEL, sender=guardian))
    st = c.data.assets["XTZ_USD"]
    sc.verify(st.paused)
    sc.verify(st.pending.is_none())
    sc.verify(st.active.is_none())
    assert last_event_tags(sc) == ["tezoracle_asset_pause"]
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL, "ASSET_PAUSED")


def test_pause_asset_discards_pending_without_promoting():
    sc, c, packer, _admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    c.pause_asset("XTZ_USD", **ctx(SUBMIT_LEVEL + DELAY, sender=guardian))
    st = c.data.assets["XTZ_USD"]
    sc.verify(st.paused)
    sc.verify(st.pending.is_none())
    sc.verify(st.active.is_none())
    assert last_event_tags(sc) == ["tezoracle_asset_pause"]
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY, "ASSET_PAUSED")
    quote = read_price(sc, c, "BTC_USD", SUBMIT_LEVEL + DELAY)
    sc.verify(quote.price == CORE_PRICES["BTC_USD"])


def test_discard_pending_before_unpause():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    c.discard_pending("XTZ_USD", **ctx(SUBMIT_LEVEL, sender=guardian))
    sc.verify(c.data.assets["XTZ_USD"].pending.is_none())
    propose_unpause(c, packer, accounts, 0, level=SUBMIT_LEVEL)
    c.activate_unpause(**ctx(SUBMIT_LEVEL + DELAY))
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY, "NO_PRICE")


def test_unpause_does_not_resurrect_quarantined_pending():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    c.pause(**ctx(SUBMIT_LEVEL + DELAY, sender=guardian))
    propose_unpause(c, packer, accounts, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_unpause(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY, "NO_PRICE")


def test_repeated_submit_faster_than_delay_rejected():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        valid=False,
        exception="PENDING_OPEN",
        level=SUBMIT_LEVEL,
        now=NOW,
    )
    sc.verify(c.data.last_round["CORE"] == 1)
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())


def test_mature_pending_can_be_replaced_after_promote():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    sc.verify(c.data.assets["XTZ_USD"].active.is_some())
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    sc.verify(c.data.last_round["CORE"] == 2)
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_config_activation_clears_pending_and_requires_fresh_publish():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    nxt = _next_init(
        admin,
        guardian,
        accounts,
        policy_hash=sp.bytes("0x" + "33" * 32),
    )
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY))
    sc.verify(c.data.assets["XTZ_USD"].pending.is_none())
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY, "NO_PRICE")


def test_config_activation_drops_active_on_decimals_change():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    sc.verify(c.data.assets["XTZ_USD"].active.is_some())
    assets = default_assets()
    assets["XTZ_USD"] = asset_policy(
        decimals=8, abs_min=10_000, abs_max=100_000_000
    )
    nxt = _next_init(admin, guardian, accounts, extra={"assets": assets})
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    sc.verify(c.data.assets["XTZ_USD"].pending.is_none())
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY, "NO_PRICE")
    quote = read_price(sc, c, "BTC_USD", SUBMIT_LEVEL + DELAY + DELAY)
    sc.verify(quote.price == CORE_PRICES["BTC_USD"])


def test_config_activation_drops_active_on_bounds_change():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    assets = default_assets()
    assets["XTZ_USD"] = asset_policy(abs_min=20_000, abs_max=100_000_000)
    nxt = _next_init(admin, guardian, accounts, extra={"assets": assets})
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    quote = read_price(sc, c, "BTC_USD", SUBMIT_LEVEL + DELAY + DELAY)
    sc.verify(quote.price == CORE_PRICES["BTC_USD"])


def test_config_activation_drops_quotes_on_signer_or_policy_change():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    new_hash = sp.bytes("0x" + "33" * 32)
    nxt = _next_init(admin, guardian, accounts, policy_hash=new_hash)
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    sc.verify(c.data.assets["BTC_USD"].active.is_none())
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY, "NO_PRICE")

    replacement = sp.test_account("signer-rotated")
    nxt2 = make_init(
        admin.address,
        guardian.address,
        [replacement],
        1,
        config_version=3,
        policy_hash=new_hash,
    )
    propose_config(
        c,
        packer,
        accounts,
        nxt2,
        1,
        current_config_version=2,
        level=SUBMIT_LEVEL + DELAY + DELAY,
    )
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY + DELAY))
    sc.verify(c.data.signers[0].public_key == replacement.public_key)
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY + DELAY, "NO_PRICE")


def test_compatible_admin_rotation_preserves_active_quote():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    new_admin = sp.test_account("admin-2")
    nxt = make_init(
        new_admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
    )
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    sc.verify(c.data.admin == new_admin.address)
    sc.verify(c.data.assets["XTZ_USD"].pending.is_none())
    sc.verify(c.data.assets["XTZ_USD"].active.is_some())
    sc.verify(c.data.assets["XTZ_USD"].active.open_some().config_version == 2)
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_config_activation_clears_pending_unpause():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    propose_unpause(c, packer, accounts, 0, level=SUBMIT_LEVEL)
    sc.verify(c.data.pending_unpause_level.is_some())
    nxt = _next_init(
        admin, guardian, accounts, policy_hash=sp.bytes("0x" + "33" * 32)
    )
    propose_config(c, packer, accounts, nxt, 1, level=SUBMIT_LEVEL)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY))
    sc.verify(c.data.paused)
    sc.verify(c.data.pending_unpause_level.is_none())
    c.activate_unpause(
        _valid=False, _exception="NO_PENDING", **ctx(SUBMIT_LEVEL + DELAY)
    )


def test_config_activation_clears_pending_asset_unpause():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause_asset("XTZ_USD", **ctx(SUBMIT_LEVEL, sender=guardian))
    propose_asset_unpause(c, packer, accounts, "XTZ_USD", 0, level=SUBMIT_LEVEL)
    sc.verify(c.data.assets["XTZ_USD"].pending_unpause_level.is_some())
    nxt = _next_init(
        admin, guardian, accounts, policy_hash=sp.bytes("0x" + "33" * 32)
    )
    propose_config(c, packer, accounts, nxt, 1, level=SUBMIT_LEVEL)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY))
    sc.verify(c.data.assets["XTZ_USD"].paused)
    sc.verify(c.data.assets["XTZ_USD"].pending_unpause_level.is_none())
    c.activate_asset_unpause(
        "XTZ_USD",
        _valid=False,
        _exception="NO_PENDING",
        **ctx(SUBMIT_LEVEL + DELAY),
    )


def test_movement_limit_pauses_asset_and_keeps_previous_active():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    wild = dict(CORE_PRICES)
    wild["USDT_USD"] = 1_090_000
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=3, assets=core_assets(prices=wild)),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY + DELAY,
        now=NOW + 2,
    )
    previous = read_price(sc, c, "USDT_USD", SUBMIT_LEVEL + DELAY + DELAY + DELAY)
    sc.verify(previous.price == CORE_PRICES["USDT_USD"])
    c.promote("USDT_USD", **ctx(SUBMIT_LEVEL + DELAY + DELAY + DELAY))
    sc.verify(c.data.assets["USDT_USD"].paused)
    sc.verify(c.data.assets["USDT_USD"].pending.is_none())
    sc.verify(c.data.assets["USDT_USD"].active.open_some().price == CORE_PRICES["USDT_USD"])
    events = last_events(sc)
    assert [e["tag"] for e in events] == ["tezoracle_movement_pause"]
    assert "USDT_USD" in events[0]["value"]
    _fail_view(
        sc, c, "USDT_USD", SUBMIT_LEVEL + DELAY + DELAY + DELAY, "ASSET_PAUSED"
    )
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_rejects_oversized_publication_group():
    assets = default_assets()
    ids = ["BTC_USD", "USDT_USD", "XTZ_USD"]
    for i in range(6):
        aid = f"X{i}_USD"
        assets[aid] = asset_policy()
        ids.append(aid)
    groups = {
        "CORE": ids,
        "USDTZ": ["USDTZ_USD"],
        "TZBTC": ["TZBTC_USD"],
    }
    with pytest.raises((FailwithException, RuntimeException, Exception)):
        originate(1, 1, extra={"assets": assets, "groups": groups})


def test_config_activation_clears_pending_even_when_active_is_kept():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    sc.verify(c.data.assets["XTZ_USD"].active.is_some())
    sc.verify(c.data.assets["XTZ_USD"].pending.is_some())
    new_admin = sp.test_account("admin-kept-quotes")
    nxt = make_init(
        new_admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
    )
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    sc.verify(c.data.assets["XTZ_USD"].pending.is_none())
    sc.verify(c.data.assets["XTZ_USD"].active.is_some())
    sc.verify(c.data.assets["XTZ_USD"].active.open_some().config_version == 2)
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_config_activation_drops_active_and_pending_on_signer_change():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    replacement = sp.test_account("signer-only-rotation")
    nxt = make_init(
        admin.address,
        guardian.address,
        [replacement],
        1,
        config_version=2,
    )
    propose_config(c, packer, accounts, nxt, 0, level=SUBMIT_LEVEL + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY))
    sc.verify(c.data.signers[0].public_key == replacement.public_key)
    sc.verify(c.data.policy_hash == sp.bytes("0x" + "11" * 32))
    sc.verify(c.data.assets["XTZ_USD"].active.is_none())
    sc.verify(c.data.assets["XTZ_USD"].pending.is_none())
    _fail_view(sc, c, "XTZ_USD", SUBMIT_LEVEL + DELAY + DELAY, "NO_PRICE")


def test_pending_unpause_cleared_on_admin_rotation():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    propose_unpause(c, packer, accounts, 0, level=SUBMIT_LEVEL)
    sc.verify(c.data.pending_unpause_level.is_some())
    new_admin = sp.test_account("admin-rotated")
    nxt = make_init(
        new_admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
    )
    propose_config(c, packer, accounts, nxt, 1, level=SUBMIT_LEVEL)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY))
    sc.verify(c.data.admin == new_admin.address)
    sc.verify(c.data.paused)
    sc.verify(c.data.pending_unpause_level.is_none())
    c.activate_unpause(
        _valid=False, _exception="NO_PENDING", **ctx(SUBMIT_LEVEL + DELAY)
    )
    propose_unpause(
        c,
        packer,
        accounts,
        2,
        current_config_version=2,
        indices=[],
        valid=False,
        exception="QUORUM",
        level=SUBMIT_LEVEL + DELAY,
        sender=admin,
    )
    propose_unpause(
        c,
        packer,
        accounts,
        2,
        current_config_version=2,
        level=SUBMIT_LEVEL + DELAY,
    )
    sc.verify(c.data.pending_unpause_level.is_some())


def test_submit_rejects_movement_exceeded_pending_without_pausing():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    submit(c, packer, accounts, make_payload(c.address, round_n=1), indices=[0])
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=2),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY,
        now=NOW + 1,
    )
    wild = dict(CORE_PRICES)
    wild["USDT_USD"] = 1_090_000
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=3, assets=core_assets(prices=wild)),
        indices=[0],
        level=SUBMIT_LEVEL + DELAY + DELAY,
        now=NOW + 2,
    )
    submit(
        c,
        packer,
        accounts,
        make_payload(c.address, round_n=4, assets=core_assets(prices=wild)),
        indices=[0],
        valid=False,
        exception="MOVEMENT",
        level=SUBMIT_LEVEL + DELAY + DELAY + DELAY,
        now=NOW + 3,
    )
    sc.verify(c.data.assets["USDT_USD"].paused == False)
    sc.verify(c.data.assets["USDT_USD"].pending.is_some())
    sc.verify(c.data.last_round["CORE"] == 3)


def test_unpause_and_config_emit_distinct_events():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    assert last_event_tags(sc) == ["tezoracle_pause"]
    propose_unpause(c, packer, accounts, 0, level=SUBMIT_LEVEL)
    assert last_event_tags(sc) == ["tezoracle_unpause_propose"]
    cancel_pending_unpause(c, packer, accounts, 1, level=SUBMIT_LEVEL)
    assert last_event_tags(sc) == ["tezoracle_unpause_cancel"]
    propose_unpause(c, packer, accounts, 2, level=SUBMIT_LEVEL)
    c.activate_unpause(**ctx(SUBMIT_LEVEL + DELAY))
    assert last_event_tags(sc) == ["tezoracle_unpause_activate"]

    c.pause_asset("XTZ_USD", **ctx(SUBMIT_LEVEL + DELAY, sender=guardian))
    assert last_event_tags(sc) == ["tezoracle_asset_pause"]
    propose_asset_unpause(
        c, packer, accounts, "XTZ_USD", 3, level=SUBMIT_LEVEL + DELAY
    )
    assert last_event_tags(sc) == ["tezoracle_asset_unpause_prop"]
    cancel_asset_unpause(
        c, packer, accounts, "XTZ_USD", 4, level=SUBMIT_LEVEL + DELAY
    )
    assert last_event_tags(sc) == ["tezoracle_asset_unpause_cancel"]
    propose_asset_unpause(
        c, packer, accounts, "XTZ_USD", 5, level=SUBMIT_LEVEL + DELAY
    )
    c.activate_asset_unpause("XTZ_USD", **ctx(SUBMIT_LEVEL + DELAY + DELAY))
    assert last_event_tags(sc) == ["tezoracle_asset_unpause_act"]

    nxt = _next_init(
        admin, guardian, accounts, policy_hash=sp.bytes("0x" + "33" * 32)
    )
    propose_config(c, packer, accounts, nxt, 6, level=SUBMIT_LEVEL + DELAY + DELAY)
    assert last_event_tags(sc) == ["tezoracle_config_propose"]
    cancel_pending_config(
        c, packer, accounts, 7, level=SUBMIT_LEVEL + DELAY + DELAY
    )
    assert last_event_tags(sc) == ["tezoracle_config_cancel"]
    propose_config(c, packer, accounts, nxt, 8, level=SUBMIT_LEVEL + DELAY + DELAY)
    c.activate_config(**ctx(SUBMIT_LEVEL + DELAY + DELAY + DELAY))
    assert last_event_tags(sc) == ["tezoracle_config_activate"]


def test_rejects_too_many_signers():
    with pytest.raises((FailwithException, RuntimeException, Exception)):
        originate(1, 17)


def test_rejects_too_many_assets():
    assets = default_assets()
    groups = dict(default_groups())
    extra_ids = []
    for i in range(12):
        aid = f"Z{i}_USD"
        assets[aid] = asset_policy()
        extra_ids.append(aid)
    groups["EXTRA1"] = extra_ids[:8]
    groups["EXTRA2"] = extra_ids[8:]
    with pytest.raises((FailwithException, RuntimeException, Exception)):
        originate(1, 1, extra={"assets": assets, "groups": groups})
