"""Aturan format & normalisasi (PRD §4, §6). Harus sejalan dengan packages/shared/src/validators.ts."""

from __future__ import annotations

import re

PASSPORT_RE = re.compile(r"^[A-Z]{1,2}\d{6,7}$")
PHONE_RE = re.compile(r"^08\d{8,11}$")
SERIAL_RE = re.compile(r"^\d{4,5}$")

_NUMERIC_FIX = str.maketrans({"O": "0", "I": "1", "S": "5"})


def normalize_numeric(raw: str) -> str:
    """O→0, I→1, S→5 lalu buang non-digit. HANYA untuk field numerik."""
    return re.sub(r"[^0-9]", "", raw.upper().translate(_NUMERIC_FIX))


_UNIT_RE = re.compile(r"\b(PCS|PC|KOLI|KG|KGS)\b", re.IGNORECASE)


def parse_count(raw: str) -> str:
    """ "2 - PCS" → "2". Satuan dibuang dulu agar S di "PCS" tidak ikut menjadi 5."""
    return normalize_numeric(_UNIT_RE.sub(" ", raw))


def normalize_passport(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", raw.upper())


def normalize_phones(raw: str) -> str:
    parts = (normalize_numeric(p) for p in re.split(r"[\s/,;]+", raw))
    return " ".join(p for p in parts if p)


def parse_weight_kg(raw: str) -> float | None:
    m = re.search(r"\d+(\.\d+)?", raw.replace(",", "."))
    return float(m.group(0)) if m else None


# Singkatan alamat: "KP-WANA SUKA" → "Kp. Wana Suka", "RT-05/06" / "Rr.16/06" → "Rt.05/06".
_ADDRESS_PREFIX = {"KP": "Kp.", "DS": "Ds.", "DSN": "Dsn.", "KEC": "Kec.", "KAB": "Kab.", "KEL": "Kel."}
_PREFIX_RE = re.compile(r"\b(KP|DSN|DS|KEC|KAB|KEL)(?:\s*[-.:]\s*|\s+)", re.IGNORECASE)
_RTRW_RE = re.compile(r"\b(?:RT|RR)\s*[-.:]?\s*(\d{1,3})\s*/\s*(\d{1,3})", re.IGNORECASE)


def normalize_address(raw: str) -> str:
    """
    Normalisasi format saja (singkatan, RT/RW, huruf besar-kecil). Koreksi ejaan
    wilayah ("WANA SUKA" → "Wanasuka") dilakukan lewat gazetteer, bukan di sini.
    """
    s = _RTRW_RE.sub(lambda m: f" \x00RT{m.group(1).zfill(2)}/{m.group(2).zfill(2)} ", raw)
    s = _PREFIX_RE.sub(lambda m: f" \x00{m.group(1).upper()} ", s)
    out: list[str] = []
    for tok in re.split(r"[\s.,]+", s):
        if not tok:
            continue
        if tok.startswith("\x00RT"):
            out.append("Rt." + tok[3:])
        elif tok.startswith("\x00"):
            out.append(_ADDRESS_PREFIX[tok[1:]])
        else:
            out.append(tok.capitalize())
    return " ".join(out)
