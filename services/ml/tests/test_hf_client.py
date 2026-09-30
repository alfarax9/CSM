import json
from types import SimpleNamespace

from csm_ml.config import load_settings
from csm_ml.hf_client import build_request, read_receipt


def test_provider_dikunci_lewat_akhiran(monkeypatch):
    monkeypatch.setenv("HF_PROVIDER", "novita")
    assert load_settings().hf_model_ref == "Qwen/Qwen3.5-397B-A17B:novita"


def test_request_hanya_gambar_dan_prompt(monkeypatch):
    monkeypatch.delenv("HF_PROVIDER", raising=False)
    req = build_request(load_settings(), ["data:image/jpeg;base64,AAAA"], "Baca resi ini.")
    assert req["model"] == "Qwen/Qwen3.5-397B-A17B"
    schema = req["response_format"]["json_schema"]["schema"]
    assert "serial_no" in schema["required"] and "packages" in schema["required"]
    user = req["messages"][1]["content"]
    assert [c["type"] for c in user] == ["image_url", "text"]


def test_read_receipt_dengan_klien_tiruan():
    hasil = {"serial_no": "35616"}

    def create(**_kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(hasil)))])

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    assert read_receipt(fake, load_settings(), ["data:,"], "x") == hasil
