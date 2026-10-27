"""Local, bounded activity history. Raw configuration and device output stay out of it."""

import json
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ActivityLog:
    def __init__(self, path: Path, *, max_rows: int = 50000, retention_days: int = 90):
        self.path = path
        self.max_rows = max_rows
        self.retention_days = retention_days

    def _connect(self):
        for attempt in range(5):
            try:
                return self._open()
            except sqlite3.OperationalError as exc:
                if "locked" not in str(exc).lower() or attempt == 4:
                    raise
                time.sleep(0.03 * 2 ** attempt)

    def _open(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        try:
            db.row_factory = sqlite3.Row
            if db.execute("PRAGMA journal_mode").fetchone()[0] != "wal":
                db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
                host TEXT NOT NULL, device_name TEXT NOT NULL, operation TEXT NOT NULL,
                category TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL,
                message TEXT NOT NULL, request_id TEXT NOT NULL,
                related_request_id TEXT NOT NULL, details TEXT NOT NULL
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS activity_host ON activity(host, id)")
            db.execute("CREATE INDEX IF NOT EXISTS activity_request ON activity(request_id, status)")
            db.execute("CREATE INDEX IF NOT EXISTS activity_related ON activity(related_request_id, status)")
            db.execute("CREATE INDEX IF NOT EXISTS activity_timestamp ON activity(timestamp)")
        except sqlite3.Error:
            db.close()
            raise
        return db

    def _prune(self, db):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=self.retention_days)).isoformat(timespec="seconds")
        db.execute("DELETE FROM activity WHERE timestamp < ?", (cutoff,))
        db.execute("""DELETE FROM activity WHERE id <= COALESCE(
            (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?), 0)""", (self.max_rows,))

    def append(self, event: dict) -> int:
        values = {key: str(event.get(key) or "") for key in (
            "host", "device_name", "operation", "category", "status", "severity",
            "message", "request_id", "related_request_id",
        )}
        values["host"] = values["host"].strip().lower()
        values["timestamp"] = event.get("timestamp") or utc_now()
        values["details"] = json.dumps(event.get("details") or {}, ensure_ascii=False)
        with closing(self._connect()) as db, db:
            cursor = db.execute("""INSERT INTO activity
                (timestamp, host, device_name, operation, category, status, severity,
                 message, request_id, related_request_id, details)
                VALUES (:timestamp, :host, :device_name, :operation, :category, :status,
                        :severity, :message, :request_id, :related_request_id, :details)""", values)
            self._prune(db)
            return cursor.lastrowid

    def read(self, *, host: str = "", view: str = "changes", before: int = 0, limit: int = 100) -> dict:
        clauses = ["NOT (a.status = 'started' AND EXISTS (SELECT 1 FROM activity b "
                   "WHERE b.request_id = a.request_id AND b.status != 'started'))"]
        params = []
        if host:
            clauses.append("a.host = ?")
            params.append(host.strip().lower())
        if view == "changes":
            clauses.append("(a.category = 'change' OR a.severity != 'info')")
        elif view == "errors":
            clauses.append("a.severity IN ('error', 'warning')")
        if before:
            clauses.append("a.id < ?")
            params.append(before)
        with closing(self._connect()) as db, db:
            self._prune(db)
            rows = db.execute("SELECT a.* FROM activity a WHERE " + " AND ".join(clauses)
                              + " ORDER BY a.id DESC LIMIT ?", [*params, limit + 1]).fetchall()
            events = []
            for row in rows[:limit]:
                event = dict(row)
                event["details"] = json.loads(event["details"])
                if event["status"] == "awaiting-confirmation":
                    confirmed = db.execute("SELECT 1 FROM activity WHERE related_request_id = ? "
                                           "AND host = ? AND status = 'confirmed' LIMIT 1",
                                           (event["request_id"], event["host"])).fetchone()
                    deadline = event["details"].get("confirmationDeadline", "")
                    event["confirmationState"] = "confirmed" if confirmed else (
                        "window-elapsed" if deadline and deadline < utc_now() else "awaiting-confirmation")
                events.append(event)
        return {"events": events, "hasMore": len(rows) > limit,
                "nextBefore": events[-1]["id"] if len(rows) > limit else None}
