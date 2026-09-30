from csm_ml.normalize import (
    PASSPORT_RE,
    normalize_address,
    normalize_numeric,
    normalize_passport,
    normalize_phones,
    parse_count,
    parse_weight_kg,
)


def test_contoh_prd_resi_35616():
    assert normalize_passport("E - 4499 715") == "E4499715"
    assert PASSPORT_RE.match("E4499715")
    assert normalize_phones("085524446728 / 085213038585") == "085524446728 085213038585"
    assert parse_weight_kg("20 - Kg") == 20


def test_o_jadi_nol_hanya_field_numerik():
    assert normalize_numeric("O81249345417") == "081249345417"


def test_alamat_format_saja():
    raw = "KP-WANA SUKA CIWIDEY. RT-05/06. DS-SUGIH MUKTI. KEC-PASIR JAMBU. KAB-BANDUNG"
    assert (
        normalize_address(raw)
        == "Kp. Wana Suka Ciwidey Rt.05/06 Ds. Sugih Mukti Kec. Pasir Jambu Kab. Bandung"
    )


def test_rr_jadi_rt():
    assert normalize_address("Rr.16/06") == "Rt.16/06"


def test_satuan_pcs_tidak_jadi_angka_5():
    assert parse_count("2 - PCS") == "2"
    assert parse_count("1 - Koli") == "1"
    assert parse_count("O") == "0"
