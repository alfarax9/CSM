"""Klien VLM lewat Hugging Face Inference Providers (OpenAI-compatible). PRD §6."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Protocol

from .config import Settings

SYSTEM_PROMPT = (
    "Anda membaca foto resi kiriman 'Jakarta Cargo Express / Sahara' yang diisi tangan dengan huruf kapital. "
    "Salin setiap field persis seperti tertulis di kertas, tanpa memperbaiki ejaan. "
    "Jika kotak kosong, tercoret, atau tidak terbaca, tulis null. Jangan menebak. "
    "Untuk kotak paket, tulis angka yang tertulis di kotak itu, atau null jika kosong. "
    "corner_note = catatan tangan admin di pojok kanan atas (nama sales, nomor container, 'Plus 1')."
)


class ChatClient(Protocol):
    """Subset klien OpenAI yang dipakai; diganti tiruan di test."""

    chat: Any


def load_schema(settings: Settings) -> dict[str, Any]:
    return json.loads(settings.schema_path.read_text(encoding="utf-8"))


def image_data_url(path: Path) -> str:
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def build_request(settings: Settings, image_urls: list[str], instruction: str) -> dict[str, Any]:
    """Request chat completion. Hanya gambar + prompt; tanpa ID resi atau metadata (PRD §6)."""
    content: list[dict[str, Any]] = [{"type": "image_url", "image_url": {"url": u}} for u in image_urls]
    content.append({"type": "text", "text": instruction})
    return {
        "model": settings.hf_model_ref,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "receipt_extraction", "schema": load_schema(settings), "strict": True},
        },
        "temperature": 0,
    }


def make_client(settings: Settings) -> ChatClient:
    if not settings.hf_token:
        raise RuntimeError("HF_TOKEN belum di-set; ekstraksi VLM tidak bisa dijalankan.")
    from openai import OpenAI

    return OpenAI(base_url=settings.hf_base_url, api_key=settings.hf_token, timeout=settings.hf_timeout_s)


def read_receipt(
    client: ChatClient, settings: Settings, image_urls: list[str], instruction: str
) -> dict[str, Any]:
    """Satu bacaan VLM → dict sesuai schema. Bacaan 1: halaman penuh; bacaan 2: crop per field."""
    resp = client.chat.completions.create(**build_request(settings, image_urls, instruction))
    return json.loads(resp.choices[0].message.content)
