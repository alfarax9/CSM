"""Baca resi dari foto → saran isian form (PRD §6). Saran selalu dicek manusia; NLP tidak menimpa diam-diam."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .normalize import (
    PASSPORT_RE,
    PHONE_RE,
    SERIAL_RE,
    normalize_address,
    normalize_numeric,
    normalize_passport,
    normalize_phones,
    parse_count,
    parse_weight_kg,
)

PACKAGE_KEYS = ("koper", "karton", "hambal", "selimut", "drum", "kotak_besi", "karung")
INSTRUCTION = "Baca resi ini dan isi semua field sesuai schema."


def _title(v: str) -> str:
    """HANIPAH BT ADE → Hanipah Bt Ade (nama tidak dikoreksi ejaannya, hanya huruf besar-kecil)."""
    return " ".join(w.capitalize() for w in v.split())


def _field(value: Any, raw: Any, level: str, reason: str | None = None) -> dict[str, Any]:
    return {"value": value, "raw": raw, "level": level, "reason": reason}


def build_suggestions(read: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """
    Output mentah VLM → saran per field form resi.
    level: `neutral` = terbaca, perlu dicek mata; `bad` = gagal validasi / tidak konsisten. Field kosong tidak disarankan.
    """
    out: dict[str, Any] = {}

    def s(k: str) -> str | None:
        v = read.get(k)
        text = str(v).strip() if v is not None else ""
        # Model kadang menulis "null" / "-" sebagai teks untuk kotak kosong.
        return None if text.lower() in ("", "null", "none", "-", "n/a") else text

    if raw := s("serial_no"):
        v = normalize_numeric(raw)
        out["serialNo"] = _field(
            v,
            raw,
            "neutral" if SERIAL_RE.match(v) else "bad",
            None if SERIAL_RE.match(v) else "Serial No harus 4–5 digit",
        )

    if raw := s("receipt_date"):
        m = re.search(r"(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})", raw)
        if m:
            d, mo, y = (int(x) for x in m.groups())
            y = y + 2000 if y < 100 else y
            try:
                when = date(y, mo, d)
            except ValueError:
                when = None
            if when:
                # Resi di-scan dalam hitungan minggu; tahun "2024" pada resi baru = salah baca angka terakhir.
                today = today or datetime.now(ZoneInfo("Asia/Jakarta")).date()
                odd = when > today + timedelta(days=2) or when < today - timedelta(days=365)
                out["receiptDate"] = _field(
                    when.isoformat(),
                    raw,
                    "bad" if odd else "neutral",
                    "Tanggal jauh dari hari ini, cek tahun/bulan" if odd else None,
                )

    for key, form in (("sender_name", "senderName"), ("recipient_name", "recipientName")):
        if raw := s(key):
            # Nama orang tidak pernah dikoreksi otomatis (PRD §13 risiko); hanya kapitalisasi.
            out[form] = _field(_title(raw), raw, "neutral")

    if raw := s("passport_no"):
        v = normalize_passport(raw)
        ok = bool(PASSPORT_RE.match(v))
        out["passportNo"] = _field(
            v,
            raw,
            "neutral" if ok else "bad",
            None if ok else "Pola paspor tidak cocok (1–2 huruf + 6–7 angka)",
        )

    # HP pengirim: nomor negara asal (mis. Arab Saudi 05…), cukup 9–15 digit.
    if raw := s("sender_phone"):
        v = normalize_numeric(raw)
        ok = 9 <= len(v) <= 15
        out["senderPhone"] = _field(
            v, raw, "neutral" if ok else "bad", None if ok else "No HP pengirim harus 9–15 digit"
        )

    # HP penerima di Indonesia: pola 08… (PRD §4); beberapa nomor dipisah spasi.
    if raw := s("recipient_phone"):
        v = normalize_phones(raw)
        ok = bool(v) and all(PHONE_RE.match(p) for p in v.split())
        reason = None if ok else "Pola HP penerima tidak cocok (08…, 10–13 digit)"
        out["recipientPhone"] = _field(v, raw, "neutral" if ok else "bad", reason)

    if raw := s("address"):
        out["address"] = _field(normalize_address(raw), raw, "neutral")

    pk = read.get("packages") or {}
    packages = {}
    for k in PACKAGE_KEYS:
        raw = pk.get(k)
        if raw not in (None, ""):
            n = parse_count(str(raw))
            if n:
                packages[k] = int(n)
    if packages:
        out["packages"] = _field(packages, pk, "neutral")

    pcs = sum(packages.values())
    if raw := s("koli_total"):
        n = parse_count(raw)
        if n:
            koli = int(n)
            mismatch = bool(packages) and koli != pcs
            out["koliTotal"] = _field(
                koli,
                raw,
                "bad" if mismatch else "neutral",
                f"Koli {koli} ≠ jumlah paket {pcs}" if mismatch else None,
            )

    if raw := s("weight_kg"):
        w = parse_weight_kg(raw)
        if w is not None:
            out["weightKg"] = _field(w, raw, "neutral" if w > 0 else "bad", None if w > 0 else "Berat 0")

    for key, form in (
        ("insurance", "insurance"),
        ("packing", "packing"),
        ("vat", "vat"),
        ("grand_total", "grandTotal"),
    ):
        if raw := s(key):
            n = parse_weight_kg(raw)
            if n is not None:
                out[form] = _field(n, raw, "neutral")

    # Validasi silang biaya: Insurance + Packing (+ VAT) = Grand Total (PRD §4 contoh 35616).
    if all(k in out for k in ("insurance", "packing", "grandTotal")):
        total = out["insurance"]["value"] + out["packing"]["value"] + (out.get("vat", {}).get("value") or 0)
        if abs(total - out["grandTotal"]["value"]) > 0.5:
            out["grandTotal"]["level"] = "bad"
            out["grandTotal"]["reason"] = (
                f"Insurance + Packing + VAT = {total:g}, bukan {out['grandTotal']['value']:g}"
            )

    # Insurance = tarif per kg × berat (17 resi asli: tarif 9 atau 13). Bila tidak habis dibagi,
    # salah satu angka kemungkinan salah baca (mis. berat 39 terbaca 30). Tanpa insurance: Grand total − Packing.
    if "weightKg" in out and out["weightKg"]["value"] > 0:
        w = out["weightKg"]["value"]
        base = (out.get("insurance") or {}).get("value")
        if base is None and "grandTotal" in out:
            base = out["grandTotal"]["value"] - ((out.get("packing") or {}).get("value") or 0)
        if base and abs(base / w - round(base / w)) > 1e-6:
            out["weightKg"]["level"] = "bad"
            out["weightKg"]["reason"] = (
                f"Biaya {base:g} bukan kelipatan berat {w:g} kg (tarif per kg), cek berat/biaya"
            )

    if raw := s("corner_note"):
        out["cornerNote"] = _field(raw, raw, "neutral")
    return out
