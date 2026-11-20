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
            db.execute("""CREATE TABLE IF NOT EXISTS known_good (
                host TEXT PRIMARY KEY, metadata TEXT NOT NULL
            )""")
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
        elif view == "known-good":
            clauses.append("(a.operation IN ('Save known good', 'Restore configuration', 'Restore confirmation'))")
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

    def observe_known_good(self, host: str, device_name: str, fingerprint: str, *, error: str = "", saved: dict | None = None) -> dict:
        """Durable last-observed catalog, independent of activity retention. No config."""
        host = host.strip().lower()
        with closing(self._connect()) as db, db:
            row = db.execute("SELECT metadata FROM known_good WHERE host = ?", (host,)).fetchone()
            previous = json.loads(row[0]) if row else {}
            same = bool(error) or (previous.get("fingerprint") == fingerprint and bool(fingerprint))
            metadata = {"host": host, "deviceName": device_name or previous.get("deviceName", ""),
                        "fingerprint": previous.get("fingerprint", "") if error else fingerprint, "observedAt": utc_now(),
                        "verifiedAt": previous.get("verifiedAt", "") if error else utc_now(),
                        "state": "unreadable" if error else "available" if fingerprint else "missing",
                        "savedAt": previous.get("savedAt", "") if same else "",
                        "operator": previous.get("operator", "") if same else "",
                        "revision": previous.get("revision", "") if same else "",
                        "label": previous.get("label", "") if same else ""}
            if saved:
                metadata.update({key: str(saved.get(key) or "")[:128] for key in ("operator", "revision", "label")})
                metadata["savedAt"] = utc_now()
            db.execute("INSERT INTO known_good (host, metadata) VALUES (?, ?) "
                       "ON CONFLICT(host) DO UPDATE SET metadata=excluded.metadata", (host, json.dumps(metadata)))
        return metadata

    def known_good(self, host: str = "") -> list[dict]:
        with closing(self._connect()) as db:
            rows = db.execute("SELECT metadata FROM known_good" + (" WHERE host = ?" if host else "")
                              + " ORDER BY host", (host.strip().lower(),) if host else ()).fetchall()
            return [json.loads(row[0]) for row in rows]
