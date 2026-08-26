#!/usr/bin/env python3
"""Compile michelson/tezoracle.tz. Wrapper so PYTHONPATH is not required."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from contract.compile import _cli

if __name__ == "__main__":
    _cli()
