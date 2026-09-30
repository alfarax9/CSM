"""Worker job ML. Jalankan: `uv run python -m csm_ml.worker`."""

from __future__ import annotations

import logging
from collections.abc import Callable

import psycopg

from . import queue
from .config import load_settings

log = logging.getLogger("csm_ml.worker")

Handler = Callable[[psycopg.Connection, queue.Job], None]


def handle_extract_receipt(conn: psycopg.Connection, job: queue.Job) -> None:
    # Fase 1: registrasi template → bacaan 1 & 2 lewat hf_client → NLP → tulis extraction_runs/extracted_fields.
    raise NotImplementedError("Pipeline extract-receipt dikerjakan di Fase 1 setelah spike VLM (PRD §13).")


HANDLERS: dict[str, Handler] = {
    "extract-receipt": handle_extract_receipt,
}


def run_once(conn: psycopg.Connection) -> bool:
    """Proses satu job. Mengembalikan False jika antrian kosong."""
    job = queue.claim(conn, list(HANDLERS))
    if job is None:
        return False
    try:
        HANDLERS[job.type](conn, job)
    except Exception as exc:  # setiap error job dicatat, worker tetap hidup
        log.exception("job %s (%s) gagal", job.id, job.type)
        queue.fail(conn, job, f"{type(exc).__name__}: {exc}")
    else:
        queue.complete(conn, job)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = load_settings()
    if not settings.database_url:
        raise SystemExit("DATABASE_URL belum di-set.")
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        conn.execute("LISTEN jobs_new")
        log.info("worker siap, menunggu job")
        while True:
            queue.requeue_stuck(conn)
            while run_once(conn):
                pass
            # Bangun saat NOTIFY jobs_new, atau polling tiap 2 detik sebagai cadangan.
            for _ in conn.notifies(timeout=2.0, stop_after=1):
                pass


if __name__ == "__main__":
    main()
