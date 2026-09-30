"""Konfigurasi dari environment. HF_TOKEN hanya ada di container ini (PRD §6)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Schema field resi bersama dengan apps/api (packages/shared/schemas).
DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "packages/shared/schemas/receipt-extraction.schema.json"
)


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    hf_token: str | None
    hf_model: str
    hf_provider: str | None
    hf_base_url: str
    hf_timeout_s: float
    schema_path: Path

    @property
    def hf_model_ref(self) -> str:
        """Penyedia dikunci lewat akhiran `:provider`; tanpa akhiran router memilih sendiri."""
        return f"{self.hf_model}:{self.hf_provider}" if self.hf_provider else self.hf_model


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL"),
        hf_token=os.environ.get("HF_TOKEN") or None,
        hf_model=os.environ.get("HF_MODEL", "Qwen/Qwen3.5-397B-A17B"),
        hf_provider=os.environ.get("HF_PROVIDER") or None,
        hf_base_url=os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1"),
        hf_timeout_s=float(os.environ.get("HF_TIMEOUT_S", "30")),
        schema_path=Path(os.environ.get("RECEIPT_SCHEMA_PATH", DEFAULT_SCHEMA_PATH)),
    )
