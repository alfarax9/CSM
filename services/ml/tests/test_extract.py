import base64
import json
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from csm_ml import api
from csm_ml.extract import build_suggestions

# Bacaan VLM untuk resi contoh PRD §4 (Serial No 35616).
READ_35616 = {
    "serial_no": "35616",
    "receipt_date": "4/8/26",
    "sender_name": "HANIPAH BT ADE",
    "passport_no": "E - 4499 715",
    "sender_phone": None,
    "recipient_name": "IBU YAYAH",
    "address": "KP-WANA SUKA CIWIDEY. RT-05/06. DS-SUGIH MUKTI. KEC-PASIR JAMBU. KAB-BANDUNG",
    "recipient_phone": "085524446728 / 085213038585",
    "packages": {
        "koper": "1",
        "karton": None,
        "hambal": None,
        "selimut": None,
        "drum": None,
        "kotak_besi": None,
        "karung": None,
    },
    "koli_total": "1 - PCS",
    "weight_kg": "20 - Kg",
    "insurance": "261",
    "packing": "25",
    "vat": None,
    "grand_total": "286",
    "corner_note": None,
}


TODAY = date(2026, 8, 10)


def test_saran_resi_35616():
    f = build_suggestions(READ_35616, TODAY)
    assert f["serialNo"]["value"] == "35616"
    assert f["receiptDate"] == {"value": "2026-08-04", "raw": "4/8/26", "level": "neutral", "reason": None}
    assert f["senderName"]["value"] == "Hanipah Bt Ade"
    assert f["passportNo"] == {"value": "E4499715", "raw": "E - 4499 715", "level": "neutral", "reason": None}
    assert f["recipientPhone"]["value"] == "085524446728 085213038585"
    assert f["address"]["value"].startswith("Kp. Wana Suka Ciwidey Rt.05/06 Ds.")
    assert f["packages"]["value"] == {"koper": 1}
    assert f["koliTotal"]["value"] == 1 and f["koliTotal"]["level"] == "neutral"
    assert f["weightKg"]["value"] == 20
    assert f["grandTotal"]["level"] == "neutral"  # 261 + 25 = 286
    assert "senderPhone" not in f  # kosong di kertas → tidak disarankan


def test_hp_pengirim_saudi_dan_teks_null():
    f = build_suggestions({**READ_35616, "sender_phone": "0560 356 139", "corner_note": "null"})
    assert f["senderPhone"] == {
        "value": "0560356139",
        "raw": "0560 356 139",
        "level": "neutral",
        "reason": None,
    }
    assert "cornerNote" not in f


def test_validasi_menandai_bad():
    f = build_suggestions({**READ_35616, "passport_no": "12345", "koli_total": "3", "grand_total": "300"})
    assert f["passportNo"]["level"] == "bad"
    assert f["koliTotal"]["level"] == "bad" and "≠ jumlah paket 1" in f["koliTotal"]["reason"]
    assert f["grandTotal"]["level"] == "bad"


def test_endpoint_extract_dengan_klien_tiruan(monkeypatch):
    def create(**_kw):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(READ_35616)))],
            usage=SimpleNamespace(prompt_tokens=1200, completion_tokens=600),
        )

    monkeypatch.setattr(
        api, "_client", SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    )
    res = TestClient(api.app).post(
        "/ml/extract", json={"imageBase64": base64.b64encode(b"\xff\xd8\xff").decode()}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["fields"]["serialNo"]["value"] == "35616"
    assert body["inputTokens"] == 1200


def test_endpoint_tanpa_token(monkeypatch):
    monkeypatch.setattr(api, "_client", None)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    res = TestClient(api.app).post("/ml/extract", json={"imageBase64": "AAAA"})
    assert res.status_code == 503


@pytest.fixture(autouse=True)
def _reset_client():
    yield
    api._client = None


def test_tanggal_janggal_ditandai_merah():
    # Resi 35598: "2026" terbaca "2024".
    f = build_suggestions({**READ_35616, "receipt_date": "28/07/2024"}, TODAY)
    assert f["receiptDate"]["value"] == "2024-07-28" and f["receiptDate"]["level"] == "bad"
    assert build_suggestions({**READ_35616, "receipt_date": "4/9/26"}, TODAY)["receiptDate"]["level"] == "bad"
    assert "receiptDate" not in build_suggestions({**READ_35616, "receipt_date": "31/2/26"}, TODAY)


def test_kredit_hf_habis_jadi_503(monkeypatch):
    class Habis(Exception):
        status_code = 402

    def create(**_kwargs):
        raise Habis("depleted")

    monkeypatch.setattr(
        api, "_client", SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    )
    res = TestClient(api.app).post("/ml/extract", json={"imageBase64": base64.b64encode(b"x").decode()})
    assert res.status_code == 503 and "kredit" in res.json()["detail"]


def test_berat_tidak_cocok_tarif_ditandai():
    # Resi asli: insurance 351 = 9 × 39 kg; berat terbaca 30 → merah.
    base = {**READ_35616, "insurance": "351", "packing": "25", "grand_total": "376"}
    assert build_suggestions({**base, "weight_kg": "39 - Kg"}, TODAY)["weightKg"]["level"] == "neutral"
    f = build_suggestions({**base, "weight_kg": "30 - Kg"}, TODAY)
    assert f["weightKg"]["level"] == "bad" and "kelipatan" in f["weightKg"]["reason"]
    # Tanpa insurance: Grand total − Packing (261 = 9 × 29).
    nol = {**READ_35616, "insurance": None, "packing": None, "grand_total": "261"}
    assert build_suggestions({**nol, "weight_kg": "29"}, TODAY)["weightKg"]["level"] == "neutral"
    assert build_suggestions({**nol, "weight_kg": "20"}, TODAY)["weightKg"]["level"] == "bad"
