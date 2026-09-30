"""HTTP internal service ml (tidak diekspos ke browser). Jalankan: `uv run uvicorn csm_ml.api:app`."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

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
