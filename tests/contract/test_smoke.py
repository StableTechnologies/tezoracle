from contract import STATUS, __version__


def test_version_is_defined() -> None:
    assert isinstance(__version__, str)
    assert len(__version__) > 0


def test_status_is_non_production() -> None:
    assert STATUS == "non-production"
