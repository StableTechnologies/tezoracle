from contract import STATUS, __version__


def test_version_is_defined() -> None:
    assert isinstance(__version__, str)
    assert len(__version__) > 0


def test_status_is_non_production() -> None:
    assert STATUS == "non-production"


def test_oracle_module_exports_contract() -> None:
    from contract.oracle import main

    assert hasattr(main, "TezOracle")
    assert hasattr(main, "Packer")
