"""Confidence per field dari kecocokan dua bacaan VLM (PRD §6)."""

from __future__ import annotations

import re

from rapidfuzz.distance import Levenshtein


def _canon(value: str) -> str:
    return re.sub(r"[\s.,\-/]+", "", value.upper())


def c_vlm(read1: str | None, read2: str | None, *, numeric: bool, token_prob: float | None = None) -> float:
    """
    Identik → 0,95 · beda kecil (edit ≤ 1, hanya teks) → 0,80 · beda → 0,60 · salah satu null → 0,50.
    Jika penyedia memberi logprobs, hasil dikalikan rata-rata probabilitas token field.
    """
    if read1 is None and read2 is None:
        score = 0.95  # dua bacaan sepakat kotak kosong
    elif read1 is None or read2 is None:
        score = 0.50
    else:
        a, b = _canon(read1), _canon(read2)
        if a == b:
            score = 0.95
        elif not numeric and Levenshtein.distance(a, b) <= 1:
            score = 0.80
        else:
            score = 0.60
    if token_prob is not None:
        score *= token_prob
    return score


def combine(c_vlm_value: float, c_nlp: float, validation_passed: bool) -> float:
    """c_field = min(c_vlm, c_nlp) × (1 jika validasi lolos, 0,5 jika gagal)."""
    return min(c_vlm_value, c_nlp) * (1.0 if validation_passed else 0.5)
