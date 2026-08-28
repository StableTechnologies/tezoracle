from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def test_ci_does_not_use_github_secrets() -> None:
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "secrets." not in ci
    assert "${{" not in ci or "secrets" not in ci.lower()


def test_ci_does_not_upgrade_pip() -> None:
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "pip install --upgrade pip" not in ci


def test_ci_installs_python_deps_with_require_hashes() -> None:
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "pip install --require-hashes -r requirements-dev.txt" in ci
    lock = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
    assert "--hash=" in lock
    assert "pytest==" in lock
    assert "smartpy-tezos==" in lock


def test_env_example_secret_fields_are_empty() -> None:
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if any(token in key for token in ("SECRET", "KEY", "TOKEN", "PASSWORD")):
            assert value == "", f"{key} must stay empty in .env.example"


def test_readme_relative_links_exist() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", readme):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        path = ROOT / target.split("#", 1)[0]
        assert path.is_file(), f"README links to missing {target}"


def test_readme_omits_docs_absent_from_this_branch() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for path in (
        "docs/ENGINEERING_RESPONSE_RU.md",
        "docs/TEZFIN_ORACLE_ENGINEERING_RESPONSE_2026_08_14.md",
        "IMPLEMENTATION_PLAN.md",
    ):
        assert f"]({path})" not in readme
