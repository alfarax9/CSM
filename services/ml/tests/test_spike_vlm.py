from pathlib import Path

import pytest
from openpyxl import Workbook

from csm_ml import spike_vlm
from csm_ml.spike_vlm import field_correct, load_labels, to_excel_shape

ROWS = [
    # NO, Pengirim, Penerima, Alamat, Kota, Serial, Paspor, Telpon, Tas, Ktn, Krg, Lain2, Pcs, Kg
    [
        1,
        "Hanipah Bt Ade",
        "Ibu Yayah",
        "Kp. Wanasuka Rt.05/06",
        "Bandung",
        35616,
        "E4499715",
        "085524446728 085213038585",
        1,
        0,
        0,
        0,
        1,
        20,
    ],
    [
        2,
        "Siti Aminah",
        "Bpk Ahmad",
        "Ds. Batumarmar Kab. Pamekasan",
        "Pamekasan",
        35617,
        "C8060823",
        "081249345417",
        0,
        0,
        0,
        2,
        2,
        145,
    ],
]


@pytest.fixture
def workbook(tmp_path: Path) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "Data Laut Container-258"
    for _ in range(18):
        ws.append([])
    ws.append(
        [
            "NO",
            "Pengirim",
            "Penerima",
            "Alamat Lengkap",
            "Kota Tujuan",
            "Serial No",
            "No Paspor",
            "No Telpon",
            "Tas",
            "Ktn",
            "Krg",
            "Lain2",
            "Pcs",
            "Kg",
        ]
    )
    for r in ROWS:
        ws.append(r)
    path = tmp_path / "container.xlsx"
    wb.save(path)
    return path


def test_label_dari_sheet_data_laut(workbook: Path):
    labels = load_labels(workbook, "258")
    assert set(labels) == {"35616", "35617"}
    assert labels["35617"]["lain2"] == "2" and labels["35616"]["passport_no"] == "E4499715"


def test_bentuk_excel_dari_bacaan_vlm():
    read = {
        "serial_no": "35616",
        "passport_no": "E - 4499 715",
        "recipient_phone": "085524446728 / 085213038585",
        "packages": {"koper": "1", "drum": "2", "hambal": None},
        "koli_total": "3 - PCS",
        "weight_kg": "20 - Kg",
    }
    shape = to_excel_shape(read)
    assert shape["passport_no"] == "E4499715" and shape["lain2"] == "2" and shape["tas"] == "1"
    assert shape["koli_total"] == "3" and shape["weight_kg"] == "20"


def test_perbandingan_field():
    assert field_correct("sender_name", "HANIPAH BT ADE", "Hanipah Bt Ade")
    assert field_correct("weight_kg", "20", "20.0")
    assert not field_correct("serial_no", "35618", "35616")


def test_run_dengan_klien_tiruan(workbook: Path, tmp_path: Path, capsys):
    img = tmp_path / "img"
    img.mkdir()
    for i in range(2):
        (img / f"hal-{i:03d}.jpg").write_bytes(b"\xff\xd8\xff")
    spike_vlm.main(
        [
            "run",
            "--images",
            str(img),
            "--labels",
            str(workbook),
            "--container",
            "258",
            "--out",
            str(tmp_path / "hasil"),
            "--fake",
            "--price-in",
            "0.6",
            "--price-out",
            "3.6",
        ]
    )
    out = capsys.readouterr().out
    assert "cocok dengan label: 2" in out
    assert "Akurasi field numerik: 100.0%" in out
    assert (tmp_path / "hasil" / "LAPORAN.md").exists()
