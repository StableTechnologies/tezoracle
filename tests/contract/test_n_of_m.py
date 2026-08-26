"""Same contract artifact, many N-of-M configurations."""

from tests.contract.harness import (
    CORE_PRICES,
    DELAY,
    SUBMIT_LEVEL,
    make_payload,
    originate,
    originate_1of1,
    read_price,
    submit,
)


def test_1_of_1_is_a_config_not_a_different_contract():
    sc, c, packer, _admin, _guardian, accounts = originate_1of1()
    sc.verify(c.data.threshold_n == 1)
    sc.verify(c.data.threshold_m == 1)
    submit(c, packer, accounts, make_payload(c.address), indices=[0])
    quote = read_price(sc, c, "BTC_USD", SUBMIT_LEVEL + DELAY)
    sc.verify(quote.price == CORE_PRICES["BTC_USD"])


def test_3_of_4_with_class_minima():
    sc, c, packer, _admin, _guardian, accounts = originate(
        3, 4, class_ids=["A", "A", "B", "B"], class_minima={"A": 1, "B": 1}
    )
    sc.verify(c.data.threshold_n == 3)
    sc.verify(c.data.threshold_m == 4)
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
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1, 1],
        valid=False,
        exception="DUPLICATE",
        level=SUBMIT_LEVEL + 1,
    )
    # Two class A, zero class B: meets N if we had 3 A's; with only two A, need a B.
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1, 2],
        level=SUBMIT_LEVEL + 2,
    )
    quote = read_price(sc, c, "USDT_USD", SUBMIT_LEVEL + 2 + DELAY)
    sc.verify(quote.price == CORE_PRICES["USDT_USD"])


def test_3_of_4_rejects_missing_class_b():
    sc, c, packer, _admin, _guardian, accounts = originate(
        3,
        4,
        class_ids=["A", "A", "A", "B"],
        class_minima={"A": 1, "B": 1},
    )
    payload = make_payload(c.address)
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1, 2],
        valid=False,
        exception="CLASS_MIN",
    )
    submit(c, packer, accounts, payload, indices=[0, 1, 3], level=SUBMIT_LEVEL + 1)
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + 1 + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_4_of_5_unit_config():
    sc, c, packer, _admin, _guardian, accounts = originate(4, 5)
    sc.verify(c.data.threshold_n == 4)
    sc.verify(c.data.threshold_m == 5)
    payload = make_payload(c.address)
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1, 2],
        valid=False,
        exception="QUORUM",
    )
    submit(c, packer, accounts, payload, indices=[0, 1, 2, 3], level=SUBMIT_LEVEL + 1)
    quote = read_price(sc, c, "XTZ_USD", SUBMIT_LEVEL + 1 + DELAY)
    sc.verify(quote.price == CORE_PRICES["XTZ_USD"])


def test_5_of_7_unit_config():
    sc, c, packer, _admin, _guardian, accounts = originate(5, 7)
    sc.verify(c.data.threshold_n == 5)
    sc.verify(c.data.threshold_m == 7)
    payload = make_payload(c.address)
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1, 2, 3],
        valid=False,
        exception="QUORUM",
    )
    submit(
        c,
        packer,
        accounts,
        payload,
        indices=[0, 1, 2, 3, 4],
        level=SUBMIT_LEVEL + 1,
    )
    quote = read_price(sc, c, "BTC_USD", SUBMIT_LEVEL + 1 + DELAY)
    sc.verify(quote.price == CORE_PRICES["BTC_USD"])
