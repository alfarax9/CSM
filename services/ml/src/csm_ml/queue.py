"""Antrian job di tabel `jobs`: FOR UPDATE SKIP LOCKED + LISTEN/NOTIFY (PRD §9)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

MAX_ATTEMPTS = 3
STUCK_AFTER = "5 minutes"

CLAIM_SQL = """
UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'queued' AND run_after <= now() AND (%(types)s::text[] IS NULL OR type = ANY(%(types)s))
  ORDER BY priority, created_at
  FOR UPDATE SKIP LOCKED LIMIT 1
) RETURNING id, type, payload, attempts
"""

REQUEUE_STUCK_SQL = f"""
UPDATE jobs SET status = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'failed'::"RunStatus" ELSE 'queued'::"RunStatus" END,
       last_error = 'macet > {STUCK_AFTER}', locked_at = NULL
WHERE status = 'running' AND locked_at < now() - interval '{STUCK_AFTER}'
"""


@dataclass(frozen=True)
class Job:
    id: str
    type: str
    payload: dict[str, Any]
    attempts: int


def claim(conn: psycopg.Connection, types: list[str] | None = None) -> Job | None:
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute(CLAIM_SQL, {"types": types})
        row = cur.fetchone()
    return (
        Job(id=str(row["id"]), type=row["type"], payload=row["payload"], attempts=row["attempts"])
        if row
        else None
    )


def complete(conn: psycopg.Connection, job: Job) -> None:
    with conn.transaction():
        conn.execute("UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = %s", (job.id,))


def fail(conn: psycopg.Connection, job: Job, error: str) -> None:
    """Coba ulang dengan backoff (30 dtk × percobaan) sampai MAX_ATTEMPTS, lalu `failed`."""
    with conn.transaction():
        conn.execute(
            """
            UPDATE jobs SET
              status = CASE WHEN attempts >= %(max)s THEN 'failed'::"RunStatus" ELSE 'queued'::"RunStatus" END,
              run_after = now() + (attempts * interval '30 seconds'),
              last_error = %(err)s, locked_at = NULL
            WHERE id = %(id)s
            """,
            {"max": MAX_ATTEMPTS, "err": error[:2000], "id": job.id},
        )


def requeue_stuck(conn: psycopg.Connection) -> int:
    with conn.transaction():
        return conn.execute(REQUEUE_STUCK_SQL).rowcount


def enqueue(conn: psycopg.Connection, type_: str, payload: dict[str, Any], priority: int = 100) -> str:
    """Dipakai test dan job internal; API memakai versi Node (apps/api/src/jobs/queue.ts)."""
    with conn.transaction():
        row = conn.execute(
            "INSERT INTO jobs (type, payload, priority) VALUES (%s, %s, %s) RETURNING id",
            (type_, Jsonb(payload), priority),
        ).fetchone()
        conn.execute("SELECT pg_notify('jobs_new', %s)", (type_,))
    assert row is not None
    return str(row[0])
