"""HTTP internal service ml (tidak diekspos ke browser). Jalankan: `uv run uvicorn csm_ml.api:app`."""

from __future__ import annotations

import base64
import binascii
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import load_settings
from .extract import INSTRUCTION, build_suggestions
from .hf_client import complete, make_client, parse_reply

app = FastAPI(title="csm-ml", docs_url=None, redoc_url=None)


class SerialRequest(BaseModel):
    imagePath: str
    formTemplate: str = "jce-v1"


class SerialResponse(BaseModel):
    serial: str | None
    conf: float
    bbox: list[int] | None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ml"}


@app.post("/ml/serial", response_model=SerialResponse)
def read_serial(_: SerialRequest) -> SerialResponse:
    # Fast path Serial No (registrasi template + model digit di CPU) dipilih di spike Fase 0.
    raise HTTPException(status_code=501, detail="Fast path Serial No belum dipasang (Fase 0 spike).")


class ExtractRequest(BaseModel):
    # Gambar dikirim API sebagai base64 (tanpa ID resi/metadata, PRD §6 "Data yang dikirim ke cloud").
    imageBase64: str


class ExtractResponse(BaseModel):
    model: str
    seconds: float
    inputTokens: int | None
    outputTokens: int | None
    fields: dict[str, Any]
    raw: dict[str, Any]


# Klien VLM dibuat sekali; bisa diganti tiruan di test.
_client: Any = None


def _get_client(settings: Any) -> Any:
    global _client
    if _client is None:
        _client = make_client(settings)
    return _client


@app.post("/ml/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest) -> ExtractResponse:
    settings = load_settings()
    if not settings.api_key and _client is None:
        raise HTTPException(
            status_code=503,
            detail=f"Baca otomatis belum aktif: kunci API {settings.provider_label} belum di-set di service ml.",
        )
    try:
        base64.b64decode(req.imageBase64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Gambar bukan base64 yang valid.") from exc

    t0 = time.perf_counter()
    try:
        client = _get_client(settings)
        resp = complete(client, settings, [f"data:image/jpeg;base64,{req.imageBase64}"], INSTRUCTION)
        raw = parse_reply(resp.choices[0].message.content)
    except Exception as exc:
        if getattr(exc, "status_code", None) == 402:
            raise HTTPException(
                status_code=503,
                detail=f"Baca otomatis berhenti: kredit {settings.provider_label} habis. Isi form manual; "
                "Super Admin perlu menambah kredit.",
            ) from exc
        raise HTTPException(
            status_code=502, detail=f"Model gagal membaca resi: {type(exc).__name__}"
        ) from exc

    usage = getattr(resp, "usage", None)
    return ExtractResponse(
        model=settings.model_ref,
        seconds=round(time.perf_counter() - t0, 2),
        inputTokens=getattr(usage, "prompt_tokens", None),
        outputTokens=getattr(usage, "completion_tokens", None),
        fields=build_suggestions(raw),
        raw=raw,
    )
