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


def test_mode_berpikir_mati_kecuali_diminta(monkeypatch):
    monkeypatch.delenv("HF_THINKING", raising=False)
    req = build_request(load_settings(), ["data:,"], "x")
    assert req["extra_body"] == {"chat_template_kwargs": {"enable_thinking": False}}
    assert req["max_tokens"] == 2048
    monkeypatch.setenv("HF_THINKING", "1")
    assert "extra_body" not in build_request(load_settings(), ["data:,"], "x")


def test_openrouter_tanpa_berpikir_dan_tolak_penyedia_yang_melatih(monkeypatch):
    monkeypatch.setenv("VLM_API", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-uji")
    monkeypatch.delenv("HF_THINKING", raising=False)
    s = load_settings()
    assert s.base_url == "https://openrouter.ai/api/v1" and s.api_key == "sk-or-uji"
    req = build_request(s, ["data:,"], "x")
    assert req["model"] == "qwen/qwen3.7-flash"
    assert req["extra_body"]["reasoning"] == {"enabled": False}
    assert req["extra_body"]["provider"] == {"require_parameters": True, "data_collection": "deny"}
    # Alibaba menolak response_format tanpa kata "JSON" di pesan.
    assert "JSON" in req["messages"][0]["content"]


def test_jawaban_dalam_list_atau_blok_kode():
    from csm_ml.hf_client import parse_reply

    assert parse_reply('[{"serial_no": "1"}]') == {"serial_no": "1"}
    assert parse_reply('```json\n{"serial_no": "1"}\n```') == {"serial_no": "1"}


def test_mode_json_object_menulis_kunci_di_prompt(monkeypatch):
    monkeypatch.setenv("VLM_JSON_MODE", "object")
    req = build_request(load_settings(), ["data:,"], "x")
    assert req["response_format"] == {"type": "json_object"}
    assert "serial_no" in req["messages"][0]["content"] and "kotak_besi" in req["messages"][0]["content"]


def test_model_tanpa_json_schema_diulang_dengan_json_object(monkeypatch):
    from csm_ml.hf_client import complete

    monkeypatch.setenv("VLM_API", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-uji")
    calls = []

    class TidakAdaPenyedia(Exception):
        status_code = 404

    def create(**kw):
        calls.append(kw["response_format"]["type"])
        if kw["response_format"]["type"] == "json_schema":
            raise TidakAdaPenyedia()
        return "ok"

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    assert complete(fake, load_settings(), ["data:,"], "x") == "ok"
    assert calls == ["json_schema", "json_object"]
