"""Governance quorum, nonce replay, and domain separation."""

from tests.contract.harness import (
    DELAY,
    NOW,
    SUBMIT_LEVEL,
    UNPAUSE_DOMAIN,
    ctx,
    make_init,
    originate,
    originate_1of1,
    propose_config,
    propose_unpause,
    cancel_pending_config,
)
import smartpy as sp


def test_governance_requires_all_active_signers_not_price_n():
    sc, c, packer, admin, guardian, accounts = originate(
        3, 4, class_ids=["A", "A", "B", "B"], class_minima={"A": 1, "B": 1}
    )
    nxt = make_init(
        admin.address,
        guardian.address,
        accounts,
        3,
        class_ids=["A", "A", "B", "B"],
        class_minima={"A": 1, "B": 1},
        config_version=2,
        policy_hash=sp.bytes("0x" + "33" * 32),
    )
    propose_config(
        c,
        packer,
        accounts,
        nxt,
        0,
        indices=[0, 1, 2],
        valid=False,
        exception="QUORUM",
    )
    propose_config(c, packer, accounts, nxt, 0, indices=[0, 1, 2, 3])
    sc.verify(c.data.governance_nonce == 1)
    sc.verify(c.data.pending_config.is_some())


def test_cancel_config_consumes_nonce_and_blocks_replay():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    nxt = make_init(
        admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
        policy_hash=sp.bytes("0x" + "33" * 32),
    )
    propose_config(c, packer, accounts, nxt, 0)
    cancel_pending_config(c, packer, accounts, 1)
    sc.verify(c.data.pending_config.is_none())
    sc.verify(c.data.governance_nonce == 2)
    cancel_pending_config(
        c, packer, accounts, 1, valid=False, exception="NONCE"
    )
    propose_config(c, packer, accounts, nxt, 0, valid=False, exception="NONCE")
    propose_config(c, packer, accounts, nxt, 2)
    sc.verify(c.data.pending_config.is_some())


def test_expired_governance_intent_rejected():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    nxt = make_init(
        admin.address,
        guardian.address,
        accounts,
        1,
        config_version=2,
        policy_hash=sp.bytes("0x" + "33" * 32),
    )
    propose_config(
        c,
        packer,
        accounts,
        nxt,
        0,
        valid_until=NOW - 1,
        valid=False,
        exception="WINDOW",
    )


def test_unpause_rejects_price_or_config_domain():
    sc, c, packer, admin, guardian, accounts = originate_1of1()
    c.pause(**ctx(SUBMIT_LEVEL, sender=guardian))
    propose_unpause(c, packer, accounts, 0)
    sc.verify(c.data.pending_unpause_level.is_some())
    sc.verify(UNPAUSE_DOMAIN == "TEZORACLE_UNPAUSE_V1")
