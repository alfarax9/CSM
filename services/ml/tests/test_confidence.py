import pytest

from csm_ml.confidence import c_vlm, combine


def test_tabel_prd():
    assert c_vlm("HANIPAH BT ADE", "HANIPAH BT ADE", numeric=False) == 0.95
    assert c_vlm("HANIPAH BT ADE", "HANIFAH BT ADE", numeric=False) == 0.80
    assert c_vlm("35616", "35618", numeric=True) == 0.60  # beda kecil tidak berlaku untuk angka
    assert c_vlm("E4499715", None, numeric=False) == 0.50


def test_logprobs_mengalikan():
    assert c_vlm("20", "20", numeric=True, token_prob=0.5) == pytest.approx(0.475)


def test_combine_validasi_gagal():
    assert combine(0.95, 0.9, validation_passed=False) == pytest.approx(0.45)
