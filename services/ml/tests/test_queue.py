"""Integrasi ke Postgres lokal (npm run db:up). Dilewati jika DATABASE_URL tidak di-set."""

import os

import psycopg
import pytest

from csm_ml import queue, worker

DB = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB, reason="DATABASE_URL tidak di-set")


@pytest.fixture
def conn():
    with psycopg.connect(DB, autocommit=True) as c:
        c.execute("DELETE FROM jobs WHERE type LIKE 'test-%' OR payload ? 'test'")
        yield c
        c.execute("DELETE FROM jobs WHERE type LIKE 'test-%' OR payload ? 'test'")


def test_claim_skip_locked(conn):
    job_id = queue.enqueue(conn, "test-a", {"test": True})
    job = queue.claim(conn, ["test-a"])
    assert job and job.id == job_id and job.attempts == 1
    assert queue.claim(conn, ["test-a"]) is None  # sudah running, tidak diambil lagi
    queue.complete(conn, job)
    status = conn.execute("SELECT status FROM jobs WHERE id = %s", (job_id,)).fetchone()[0]
    assert status == "done"


def test_worker_mencatat_error_dan_coba_ulang(conn):
    job_id = queue.enqueue(conn, "extract-receipt", {"test": True})
    assert worker.run_once(conn) is True
    status, attempts, err = conn.execute(
        "SELECT status, attempts, last_error FROM jobs WHERE id = %s", (job_id,)
    ).fetchone()
    assert status == "queued" and attempts == 1 and "NotImplementedError" in err
