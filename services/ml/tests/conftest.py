"""Muat DATABASE_URL dari .env root saat test dijalankan lokal (CI mengisinya lewat env)."""

import os
from pathlib import Path

_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"

if "DATABASE_URL" not in os.environ and _ROOT_ENV.exists():
    for line in _ROOT_ENV.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() == "DATABASE_URL":
            os.environ["DATABASE_URL"] = value.strip()
