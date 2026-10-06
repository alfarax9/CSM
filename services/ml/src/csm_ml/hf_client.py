"""Klien VLM lewat Hugging Face Inference Providers atau OpenRouter (keduanya OpenAI-compatible). PRD §6."""

from __future__ import annotations

import base64
import json
from dataclasses import replace
from pathlib import Path
from typing import Any, Protocol

from .config import Settings

SYSTEM_PROMPT = (
    "Anda membaca foto resi kiriman 'Jakarta Cargo Express / Sahara' yang diisi tangan. "
    "Salin setiap field persis seperti tertulis di kertas, tanpa memperbaiki ejaan. "
    "Jika kotak kosong, tercoret, atau tidak terbaca, tulis null. Jangan menebak. "
    "Abaikan teks cetak formulir (alamat & nomor kontak kantor di bagian atas). "
    "receipt_date = tanggal di kotak 'Date' (hari/bulan/tahun). "
    "sender_name & passport_no = baris 1 dan 2 kotak 'Pengirim / Sender'. "
    "sender_phone = nomor HP yang ditulis tangan di bawah tulisan 'Pengirim / Sender' di bagian bawah resi "
    "(biasanya nomor Arab Saudi 05…); bukan nomor di bawah 'Penerima / Recipient' di kiri bawah. "
    "recipient_name = baris pertama kotak 'Penerima / Recipient'; address = baris-baris berikutnya sampai sebelum "
    "nomor HP; recipient_phone = semua nomor HP penerima (08…), dipisah spasi. "
    "packages: tiap kotak di bawah Koper/Karton/Hambal/Selimut/Drum/Kotak Besi/Karung berisi angka jumlah; "
    "tulis angkanya saja, atau null jika kotak kosong. Abaikan angka yang ditulis di luar kotak. "
    "Garis atau lengkung panjang yang melintasi kotak Insurance/Packing/VAT berarti kosong (null). "
    "corner_note = catatan tangan admin di pojok kanan atas (nama sales, nomor container, 'Plus 1'). "
    # Alibaba (lewat OpenRouter) mewajibkan kata "JSON" di pesan saat response_format dipakai.
    "Jawab hanya dengan satu objek JSON sesuai schema."
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
    schema = load_schema(settings)
    system = SYSTEM_PROMPT
    if settings.vlm_json_mode == "object":
        # Tanpa json_schema ketat: daftar kunci ditulis di prompt.
        pk = ", ".join(schema["properties"]["packages"]["required"])
        keys = ", ".join(k if k != "packages" else f"packages {{{pk}}}" for k in schema["required"])
        system += f" Kunci JSON wajib: {keys}."
    req: dict[str, Any] = {
        "model": settings.model_ref,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "response_format": (
            {"type": "json_object"}
            if settings.vlm_json_mode == "object"
            else {
                "type": "json_schema",
                "json_schema": {"name": "receipt_extraction", "schema": schema, "strict": True},
            }
        ),
        "temperature": 0,
        # Batas biaya: JSON jawaban ±400 token. Bila terpotong, bacaan gagal dan form diisi manual.
        "max_tokens": 8192 if settings.hf_thinking else 2048,
    }
    if settings.openrouter:
        # Parameter OpenRouter: mode berpikir lewat `reasoning`; tolak penyedia yang tidak mendukung
        # response_format (require_parameters) atau yang memakai input untuk melatih model (data_collection).
        req["extra_body"] = {"provider": {"require_parameters": True, "data_collection": "deny"}}
        # Model "-instruct" tidak punya mode berpikir; mengirim `reasoning` justru menyingkirkan semua penyedianya.
        if "instruct" not in settings.model_ref:
            req["extra_body"]["reasoning"] = {"enabled": settings.hf_thinking}
    elif not settings.hf_thinking:
        req["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
    return req


def make_client(settings: Settings) -> ChatClient:
    if not settings.api_key:
        raise RuntimeError(
            f"Kunci API {settings.provider_label} belum di-set; ekstraksi VLM tidak bisa dijalankan."
        )
    from openai import OpenAI

    return OpenAI(base_url=settings.base_url, api_key=settings.api_key, timeout=settings.hf_timeout_s)


def complete(client: ChatClient, settings: Settings, image_urls: list[str], instruction: str) -> Any:
    """
    Panggil model. Sebagian model OpenRouter (mis. qwen3.7-flash) hanya mendukung json_object, bukan json_schema:
    OpenRouter menjawab 404 "No endpoints found" → ulangi sekali dengan mode json_object.
    """
    try:
        return client.chat.completions.create(**build_request(settings, image_urls, instruction))
    except Exception as exc:
        if not (
            settings.openrouter
            and settings.vlm_json_mode == "schema"
            and getattr(exc, "status_code", None) == 404
        ):
            raise
    fallback = replace(settings, vlm_json_mode="object")
    return client.chat.completions.create(**build_request(fallback, image_urls, instruction))


def read_receipt(
    client: ChatClient, settings: Settings, image_urls: list[str], instruction: str
) -> dict[str, Any]:
    """Satu bacaan VLM → dict sesuai schema. Bacaan 1: halaman penuh; bacaan 2: crop per field."""
    resp = complete(client, settings, image_urls, instruction)
    return parse_reply(resp.choices[0].message.content)


def parse_reply(content: str) -> dict[str, Any]:
    """Isi jawaban model → dict. Sebagian model membungkus objek dalam list atau blok ```json."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        data = data[0]
    if not isinstance(data, dict):
        raise TypeError("Jawaban model bukan objek JSON.")
    return data
