import json
from types import SimpleNamespace

from csm_ml.config import load_settings
from csm_ml.evaluate import EvalResult, comparable, run

LABEL = {
    "image": "a.jpg",
    "serialNo": "35616",
    "receiptDate": "2026-08-04",
    "senderName": "HANIPAH BT ADE",
    "passportNo": "E4499715",
    "senderPhone": None,
    "recipientName": "IBU YAYAH",
    "address": "KP-WANA SUKA. RT-05/06",
    "recipientPhone": "085213038585 085524446728",
    "packages": {"koper": 1},
    "koliTotal": 1,
    "weightKg": 20,
    "insurance": 261,
    "packing": 25,
    "vat": None,
    "grandTotal": 286,
}
READ = {
    "serial_no": "35616",
    "receipt_date": "4/8/26",
    "sender_name": "HANIPAH BT ADE",
    "passport_no": "E - 4499 715",
    "sender_phone": None,
    "recipient_name": "IBU YAYAH",
    "address": "Kp. Wana Suka Rt.05/06",
    "recipient_phone": "085524446728 / 085213038585",
    "packages": {"koper": "1", "karton": None},
    "koli_total": "1 - PCS",
    "weight_kg": "20 Kg",
    "insurance": "261",
    "packing": "25",
    "vat": None,
    "grand_total": "286",
    "corner_note": None,
}


def fake(reads):
    answers = iter(reads)

    def create(**_kwargs):
        content = json.dumps(next(answers))
        usage = SimpleNamespace(prompt_tokens=900, completion_tokens=350)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=usage
        )

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def test_bentuk_pembanding():
    assert comparable("address", "KP-WANA SUKA. RT-5/6") == comparable("address", "Kp. Wana Suka Rt.05/06")
    assert comparable("recipientPhone", "081200000001 / 081300000002") == comparable(
        "recipientPhone", "081300000002 081200000001"
    )
    assert comparable("packages", {"koper": 1, "karton": 0}) == {"koper": 1}
    assert comparable("vat", None) is None and comparable("insurance", "261") == 261.0


def test_semua_benar_dan_satu_salah(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"x")
    (tmp_path / "b.jpg").write_bytes(b"x")
    salah = {**READ, "passport_no": "E4499716", "insurance": "251"}
    result, raw = run(fake([READ, salah]), load_settings(), tmp_path, [LABEL, {**LABEL, "image": "b.jpg"}])
    assert result.receipts == 2 and result.fully_correct == 1 and result.failed == 0
    assert result.correct["passportNo"] == 1 and result.correct["address"] == 2
    assert {d["field"] for d in result.diffs} == {"passportNo", "insurance"}
    # Insurance salah → validasi silang total menandai Grand total merah, tapi field itu sendiri tidak.
    assert result.wrong_flagged == 0 and result.wrong_total == 2
    assert "Akurasi semua field: 93.3%" in result.report()
    assert len(raw) == 2


def test_laporan_kosong_tidak_error():
    assert "Resi: 0" in EvalResult().report()


def test_kunci_ragu_tidak_dinilai(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"x")
    result, _ = run(
        fake([{**READ, "passport_no": "E1"}]), load_settings(), tmp_path, [{**LABEL, "passportNo": "?"}]
    )
    assert result.scored.get("passportNo") is None and result.fully_correct == 1
    assert "| No paspor | 0/0 |" in result.report()


def test_nilai_ulang_tanpa_model():
    from csm_ml.evaluate import rescore

    result = rescore(
        [{"image": "a.jpg", "read": READ}, {"image": "b.jpg", "error": "x"}],
        [LABEL, {**LABEL, "image": "b.jpg"}],
    )
    assert result.receipts == 1 and result.failed == 1 and result.fully_correct == 1
