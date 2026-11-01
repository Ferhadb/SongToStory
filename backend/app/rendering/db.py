"""SQLite export history. One short-lived connection per call (jobs are few)."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- queued | preparing | rendering | encoding | finalizing | completed | failed | cancelled
  progress REAL NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,        -- download name
  quality TEXT NOT NULL,
  width INTEGER, height INTEGER, duration_ms INTEGER, size_bytes INTEGER,
  created_at TEXT NOT NULL, finished_at TEXT
);
"""

COLUMNS = ["id", "status", "progress", "error_code", "error_message", "title", "filename", "quality", "width", "height", "duration_ms", "size_bytes", "created_at", "finished_at"]


class RenderDB:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._conn()) as c:
            c.executescript(SCHEMA)
            # Jobs interrupted by a restart can never finish.
            c.execute(
                "UPDATE renders SET status='failed', error_code='interrupted', "
                "error_message='The server restarted while this export was running.' "
                "WHERE status NOT IN ('completed','failed','cancelled')"
            )
            c.commit()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        return c

    def insert(self, row: dict) -> None:
        with closing(self._conn()) as c:
            c.execute(
                f"INSERT INTO renders ({','.join(row)}) VALUES ({','.join('?' * len(row))})",
                list(row.values()),
            )
            c.commit()

    def update(self, id: str, **fields) -> None:
        assert set(fields) <= set(COLUMNS)
        with closing(self._conn()) as c:
            c.execute(
                f"UPDATE renders SET {','.join(f'{k}=?' for k in fields)} WHERE id=?",
                [*fields.values(), id],
            )
            c.commit()

    def get(self, id: str) -> dict | None:
        with closing(self._conn()) as c:
            r = c.execute("SELECT * FROM renders WHERE id=?", (id,)).fetchone()
        return dict(r) if r else None

    def list(self, limit: int = 30) -> list[dict]:
        with closing(self._conn()) as c:
            rows = c.execute("SELECT * FROM renders ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def delete(self, id: str) -> None:
        with closing(self._conn()) as c:
            c.execute("DELETE FROM renders WHERE id=?", (id,))
            c.commit()
