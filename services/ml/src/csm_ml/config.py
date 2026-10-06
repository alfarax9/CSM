"""Konfigurasi dari environment. Kunci API model (HF_TOKEN / OPENROUTER_API_KEY) hanya ada di container ini (PRD §6)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Schema field resi bersama dengan apps/api (packages/shared/schemas).
DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "packages/shared/schemas/receipt-extraction.schema.json"
)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    hf_token: str | None
    hf_model: str
    hf_provider: str | None
    hf_base_url: str
    hf_timeout_s: float
    hf_thinking: bool
    schema_path: Path
    # Penyedia VLM: "huggingface" (bawaan) atau "openrouter".
    vlm_api: str = "huggingface"
    openrouter_key: str | None = None
    openrouter_model: str = "qwen/qwen3.7-flash"
    # "schema" (json_schema ketat, bawaan) atau "object" untuk model yang hanya mendukung json_object.
    vlm_json_mode: str = "schema"

    @property
    def hf_model_ref(self) -> str:
        """Penyedia dikunci lewat akhiran `:provider`; tanpa akhiran router memilih sendiri."""
        return f"{self.hf_model}:{self.hf_provider}" if self.hf_provider else self.hf_model

    @property
    def openrouter(self) -> bool:
        return self.vlm_api == "openrouter"

    @property
    def api_key(self) -> str | None:
        return self.openrouter_key if self.openrouter else self.hf_token

    @property
    def base_url(self) -> str:
        return OPENROUTER_BASE_URL if self.openrouter else self.hf_base_url

    @property
    def model_ref(self) -> str:
        return self.openrouter_model if self.openrouter else self.hf_model_ref

    @property
    def provider_label(self) -> str:
        return "OpenRouter" if self.openrouter else "Hugging Face"


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL"),
        hf_token=os.environ.get("HF_TOKEN") or None,
        hf_model=os.environ.get("HF_MODEL", "Qwen/Qwen3.5-397B-A17B"),
        hf_provider=os.environ.get("HF_PROVIDER") or None,
        hf_base_url=os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1"),
        hf_timeout_s=float(os.environ.get("HF_TIMEOUT_S", "30")),
        # Mode "berpikir" Qwen3.5 aktif bawaan: ±5.000 token & ±2,5 menit per resi. Matikan kecuali sedang diuji.
        hf_thinking=os.environ.get("HF_THINKING", "").lower() in ("1", "true", "on"),
        schema_path=Path(os.environ.get("RECEIPT_SCHEMA_PATH", DEFAULT_SCHEMA_PATH)),
        vlm_api=os.environ.get("VLM_API", "huggingface").lower(),
        openrouter_key=os.environ.get("OPENROUTER_API_KEY") or None,
        openrouter_model=os.environ.get("OPENROUTER_MODEL", "qwen/qwen3.7-flash"),
        vlm_json_mode=os.environ.get("VLM_JSON_MODE", "schema").lower(),
    )
