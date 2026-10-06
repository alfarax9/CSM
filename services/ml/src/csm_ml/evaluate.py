"""
Ukur akurasi baca resi asli lewat jalur produksi yang sama (VLM → build_suggestions → saran form).

    uv run python -m csm_ml.evaluate --images ~/csm-data/eval/img --labels ~/csm-data/eval/kunci.json \\
        --out ~/csm-data/eval/hasil --price-in 0.60 --price-out 3.60

`kunci.json` = daftar kunci jawaban yang sudah dicek dengan kertas asli, satu objek per resi, memakai nama field form:

    {"image": "35598.jpg", "serialNo": "35598", "receiptDate": "2026-07-28", "senderName": "...",
     "passportNo": "AS902654", "senderPhone": "0508378690", "recipientName": "...", "address": "...",
     "recipientPhone": "0857... 0812...", "packages": {"karton": 2}, "koliTotal": 2, "weightKg": 72,
     "insurance": 648, "packing": 50, "vat": null, "grandTotal": 698}

Nilai null = kotak di kertas kosong (benar jika model juga tidak mengisi). Nilai "?" = tidak terbaca pasti, tidak dinilai.
Data resi berisi paspor & HP: kunci, gambar, dan hasil harus di luar repo. Laporan di layar hanya angka.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rapidfuzz.distance import Levenshtein

from .config import load_settings
from .extract import INSTRUCTION, build_suggestions
from .hf_client import complete, image_data_url, make_client, parse_reply
from .normalize import normalize_address, normalize_numeric, normalize_passport, normalize_phones

FIELDS = (
    "serialNo",
    "receiptDate",
    "senderName",
    "passportNo",
    "senderPhone",
    "recipientName",
    "address",
    "recipientPhone",
    "packages",
    "koliTotal",
    "weightKg",
    "insurance",
    "packing",
    "vat",
    "grandTotal",
)
TEXT_FIELDS = ("senderName", "recipientName", "address")
# Nilai kunci "?" = tulisan di kertas tidak bisa dipastikan manusia; field itu tidak dinilai.
UNSURE = "?"
NUMERIC_FIELDS = (
    "serialNo",
    "receiptDate",
    "senderPhone",
    "passportNo",
    "recipientPhone",
    "packages",
    "koliTotal",
    "weightKg",
    "insurance",
    "packing",
    "vat",
    "grandTotal",
)
LABEL = {
    "serialNo": "Serial No",
    "receiptDate": "Tanggal",
    "senderName": "Nama pengirim",
    "passportNo": "No paspor",
    "senderPhone": "HP pengirim",
    "recipientName": "Nama penerima",
    "address": "Alamat",
    "recipientPhone": "HP penerima",
    "packages": "Jenis paket",
    "koliTotal": "Koli",
    "weightKg": "Berat",
    "insurance": "Insurance",
    "packing": "Packing",
    "vat": "VAT",
    "grandTotal": "Grand total",
}


def _canon(v: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(v or "").upper())


def comparable(key: str, value: Any) -> Any:
    """Nilai kunci jawaban atau saran model → bentuk yang dibandingkan (None = kosong)."""
    if value in (None, "", {}):
        return None
    if key == "address":
        return _canon(normalize_address(str(value))) or None
    if key in ("senderName", "recipientName"):
        return _canon(value) or None
    if key == "passportNo":
        return normalize_passport(str(value)) or None
    if key in ("serialNo", "senderPhone"):
        return normalize_numeric(str(value)) or None
    if key == "recipientPhone":
        # Urutan nomor tidak penting.
        return frozenset(normalize_phones(str(value)).split()) or None
    if key == "packages":
        return {k: int(v) for k, v in value.items() if v} or None
    if key == "receiptDate":
        return str(value)
    return float(value)


def char_error_rate(predicted: Any, truth: Any) -> float:
    t = _canon(truth)
    return Levenshtein.distance(_canon(predicted), t) / max(len(t), 1)


@dataclass
class EvalResult:
    receipts: int = 0
    failed: int = 0
    fully_correct: int = 0
    latencies: list[float] = field(default_factory=list)
    tokens_in: list[int] = field(default_factory=list)
    tokens_out: list[int] = field(default_factory=list)
    correct: dict[str, int] = field(default_factory=dict)
    scored: dict[str, int] = field(default_factory=dict)
    cer: dict[str, list[float]] = field(default_factory=dict)
    wrong_flagged: int = 0
    wrong_total: int = 0
    diffs: list[dict[str, Any]] = field(default_factory=list)

    def add(self, image: str, suggestions: dict[str, Any], truth: dict[str, Any]) -> None:
        self.receipts += 1
        all_ok = True
        for k in FIELDS:
            if truth.get(k) == UNSURE:
                continue
            self.scored[k] = self.scored.get(k, 0) + 1
            sug = suggestions.get(k) or {}
            pred = sug.get("value")
            ok = comparable(k, pred) == comparable(k, truth.get(k))
            if ok:
                self.correct[k] = self.correct.get(k, 0) + 1
            else:
                all_ok = False
                self.wrong_total += 1
                flagged = sug.get("level") == "bad"
                self.wrong_flagged += flagged
                self.diffs.append(
                    {
                        "image": image,
                        "field": k,
                        "truth": truth.get(k),
                        "predicted": pred,
                        "raw": sug.get("raw"),
                        "flagged": flagged,
                    }
                )
            if k in TEXT_FIELDS and truth.get(k):
                self.cer.setdefault(k, []).append(char_error_rate(pred, truth[k]))
        self.fully_correct += all_ok

    def accuracy(self, keys: tuple[str, ...] = FIELDS) -> float:
        total = sum(self.scored.get(k, 0) for k in keys)
        return sum(self.correct.get(k, 0) for k in keys) / total if total else 0.0

    def report(self, price_in: float | None = None, price_out: float | None = None) -> str:
        n = self.receipts
        lines = [
            "# Akurasi baca resi asli",
            "",
            f"Resi: {n} · gagal dibaca: {self.failed} · semua field benar: {self.fully_correct}/{n}",
            "",
            "| Field | Benar | Akurasi | CER |",
            "| --- | --- | --- | --- |",
        ]
        for k in FIELDS:
            c, t = self.correct.get(k, 0), self.scored.get(k, 0)
            cer = f"{statistics.mean(self.cer[k]):.1%}" if self.cer.get(k) else "–"
            lines.append(f"| {LABEL[k]} | {c}/{t} | {c / t if t else 0:.0%} | {cer} |")
        lines += [
            "",
            f"**Akurasi semua field: {self.accuracy():.1%}** (gate Fase 0: ≥ 80%)",
            f"**Akurasi field angka: {self.accuracy(NUMERIC_FIELDS):.1%}** (gate Fase 0: ≥ 95%)",
            f"Field salah yang ditandai merah oleh validasi: {self.wrong_flagged}/{self.wrong_total}",
        ]
        if self.latencies:
            p95 = (
                statistics.quantiles(self.latencies, n=20)[18]
                if len(self.latencies) >= 2
                else self.latencies[0]
            )
            lines.append(
                f"Waktu per resi: median {statistics.median(self.latencies):.1f} dtk · p95 {p95:.1f} dtk"
            )
        if self.tokens_in:
            ti, to = statistics.mean(self.tokens_in), statistics.mean(self.tokens_out)
            lines.append(f"Token rata-rata per resi: input {ti:.0f} · output {to:.0f}")
            if price_in is not None and price_out is not None:
                cost = (ti * price_in + to * price_out) / 1_000_000
                lines.append(
                    f"Biaya per resi ≈ USD {cost:.4f} · per container (250 resi) ≈ USD {cost * 250:.2f}"
                )
        return "\n".join(lines)


def run(client: Any, settings: Any, images: Path, labels: list[dict[str, Any]]) -> tuple[EvalResult, list]:
    result, raw = EvalResult(), []
    for truth in labels:
        img = images / truth["image"]
        t0 = time.perf_counter()
        try:
            resp = complete(client, settings, [image_data_url(img)], INSTRUCTION)
            read = parse_reply(resp.choices[0].message.content)
        except Exception as exc:  # noqa: BLE001 — setiap kegagalan dicatat, evaluasi tetap lanjut
            result.failed += 1
            raw.append({"image": img.name, "error": f"{type(exc).__name__}: {exc}"})
            continue
        result.latencies.append(time.perf_counter() - t0)
        if getattr(resp, "usage", None):
            result.tokens_in.append(resp.usage.prompt_tokens)
            result.tokens_out.append(resp.usage.completion_tokens)
        raw.append({"image": img.name, "read": read})
        result.add(img.name, build_suggestions(read), truth)
    return result, raw


def _fmt(v: Any) -> str:
    if isinstance(v, (set, frozenset)):
        return " ".join(sorted(v))
    return (
        "–" if v in (None, "", {}) else json.dumps(v, ensure_ascii=False) if isinstance(v, dict) else str(v)
    )


def rescore(raw: list[dict[str, Any]], labels: list[dict[str, Any]]) -> EvalResult:
    """Nilai ulang bacaan tersimpan (bacaan-mentah.json) dengan kunci/aturan terbaru, tanpa memanggil model."""
    reads = {r["image"]: r for r in raw}
    result = EvalResult()
    for truth in labels:
        r = reads.get(truth["image"])
        if r is None or "read" not in r:
            result.failed += 1
            continue
        result.add(truth["image"], build_suggestions(r["read"]), truth)
    return result


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="evaluate", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--images", required=True)
    parser.add_argument("--labels", required=True, help="kunci jawaban JSON (lihat contoh di atas)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", nargs="*", help="hanya file gambar ini (mis. 35598.jpg)")
    parser.add_argument(
        "--rescore", action="store_true", help="nilai ulang bacaan-mentah.json di --out tanpa memanggil model"
    )
    parser.add_argument("--price-in", type=float, help="USD per 1 juta token input")
    parser.add_argument("--price-out", type=float, help="USD per 1 juta token output")
    args = parser.parse_args(argv)

    labels = json.loads(Path(args.labels).expanduser().read_text(encoding="utf-8"))
    if args.only:
        labels = [x for x in labels if x["image"] in set(args.only)]
    settings = load_settings()
    if args.rescore:
        raw = json.loads((Path(args.out).expanduser() / "bacaan-mentah.json").read_text(encoding="utf-8"))
        result = rescore(raw, labels)
    else:
        result, raw = run(make_client(settings), settings, Path(args.images).expanduser(), labels)

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    (out / "bacaan-mentah.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    rows = ["| Resi | Field | Kunci | Model | Mentah | Merah |", "| --- | --- | --- | --- | --- | --- |"]
    rows += [
        f"| {d['image']} | {LABEL[d['field']]} | {_fmt(d['truth'])} | {_fmt(d['predicted'])} | "
        f"{_fmt(d['raw'])} | {'ya' if d['flagged'] else ''} |"
        for d in result.diffs
    ]
    (out / "selisih.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    text = result.report(args.price_in, args.price_out)
    (out / "LAPORAN.md").write_text(text + "\n", encoding="utf-8")
    print(text)
    print(f"\nRincian selisih (berisi data pribadi, jangan dibagikan): {out / 'selisih.md'}")


if __name__ == "__main__":
    main()
