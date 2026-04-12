#!/usr/bin/env python3
# ruff: noqa: PLR0915,S603,S607,S108
"""Forward Motion runtime entrypoint.

Modes:
- diff (default): scan + diff against processed state, update scanned state, emit queue
- mark-processed: advance processed state for completed items provided on stdin

This keeps runtime state handling in one script while leaving message actions to the
workflow agent described in AGENT.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

WORKFLOW_DIR = Path(__file__).resolve().parents[1]
DB_PATH = WORKFLOW_DIR / "forward-motion.db"
SCAN_SCRIPT = WORKFLOW_DIR / "scripts" / "scan.py"
TELETHON_PYTHON = os.environ.get(
    "FORWARD_MOTION_PYTHON",
    "/tmp/tg-topics/bin/python3",  # noqa: S108
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def run_scan(rules_path: Path | None = None) -> dict[str, Any]:
    cmd = [TELETHON_PYTHON, str(SCAN_SCRIPT)]
    if rules_path:
        cmd.extend(["--rules", str(rules_path)])
    proc = subprocess.run(  # noqa: S603
        cmd,
        check=False,
        capture_output=True,
        text=True,
        timeout=240,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "scan failed")
    return json.loads(proc.stdout)


def ensure_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA user_version")
    version = cur.fetchone()[0]
    if version < 2:
        cur.execute("DROP TABLE IF EXISTS checked_threads")
        cur.execute("DROP TABLE IF EXISTS actions_taken")
        cur.execute(
            """CREATE TABLE checked_threads (
                thread_key TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                topic_id TEXT,
                thread_name TEXT,
                last_scanned_at TEXT,
                last_scanned_msg_id TEXT,
                last_processed_at TEXT,
                last_processed_msg_id TEXT,
                status TEXT DEFAULT 'ok',
                notes TEXT
            )"""
        )
        cur.execute(
            """CREATE TABLE actions_taken (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_key TEXT NOT NULL,
                action_at TEXT NOT NULL,
                action_type TEXT NOT NULL,
                description TEXT,
                reviewed_by TEXT,
                reaction_emoji TEXT,
                posted_to_human INTEGER DEFAULT 0
            )"""
        )
        cur.execute("PRAGMA user_version = 2")
        conn.commit()
    return conn


def processed_state(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    cur = conn.cursor()
    cur.execute(
        "SELECT thread_key, last_processed_msg_id, "
        "last_processed_at, status FROM checked_threads"
    )
    return {
        row[0]: {
            "last_msg_id": row[1],
            "last_processed": row[2],
            "status": row[3],
        }
        for row in cur.fetchall()
    }


def update_scanned_state(
    conn: sqlite3.Connection, threads: dict[str, dict[str, Any]]
) -> None:
    cur = conn.cursor()
    now = utc_now()
    for key, info in threads.items():
        if info.get("skipped") or info.get("error") or info.get("msg_id") is None:
            continue
        parts = key.split(":")
        chat_id = parts[0]
        topic_id = parts[1] if len(parts) > 1 else None
        cur.execute(
            """INSERT INTO checked_threads
                (
                    thread_key,
                    chat_id,
                    topic_id,
                    thread_name,
                    last_scanned_at,
                    last_scanned_msg_id
                )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_key) DO UPDATE SET
                thread_name=excluded.thread_name,
                last_scanned_at=excluded.last_scanned_at,
                last_scanned_msg_id=excluded.last_scanned_msg_id
            """,
            (
                key,
                chat_id,
                topic_id,
                info.get("thread_name", key),
                now,
                str(info.get("msg_id")),
            ),
        )
    conn.commit()


def build_diff(
    scan: dict[str, Any],
    prev_state: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], list[str]]:
    threads = scan["threads"]
    new_activity: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    skipped: list[str] = []
    unchanged: list[str] = []

    for key, info in threads.items():
        if info.get("skipped"):
            skipped.append(key)
            continue
        if info.get("error"):
            errors.append(
                {
                    "key": key,
                    "name": info.get("thread_name", key),
                    "error": info["error"],
                }
            )
            continue
        msg_id = info.get("msg_id")
        if msg_id is None:
            unchanged.append(key)
            continue
        prev = prev_state.get(key)
        if prev and str(prev["last_msg_id"]) == str(msg_id):
            unchanged.append(key)
            continue
        new_activity.append(
            {
                "key": key,
                "thread_name": info.get("thread_name", key),
                "scope": info.get("scope", "fleet"),
                "latest_msg_id": msg_id,
                "latest_msg_at": info.get("msg_at", ""),
                "sender": info.get("sender", ""),
                "preview": info.get("preview", ""),
                "prev_processed_msg_id": prev["last_msg_id"] if prev else None,
            }
        )

    return new_activity, errors, skipped, unchanged


def mark_processed(
    conn: sqlite3.Connection, completed: list[dict[str, Any]]
) -> dict[str, Any]:
    cur = conn.cursor()
    now = utc_now()
    action_count = 0
    for item in completed:
        cur.execute(
            """UPDATE checked_threads
            SET last_processed_at = ?,
                last_processed_msg_id = ?,
                status = ?,
                notes = ?
            WHERE thread_key = ?""",
            (
                now,
                str(item["msg_id"]),
                item.get("status", "ok"),
                item.get("description", ""),
                item["key"],
            ),
        )
        action_type = item.get("action_type")
        if action_type and action_type != "none":
            cur.execute(
                """INSERT INTO actions_taken
                    (thread_key, action_at, action_type, description,
                     reviewed_by, reaction_emoji, posted_to_human)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    item["key"],
                    now,
                    action_type,
                    item.get("description", ""),
                    item.get("reviewed_by"),
                    item.get("reaction_emoji"),
                    1 if item.get("posted_to_human") else 0,
                ),
            )
            action_count += 1
    conn.commit()
    return {
        "updated": len(completed),
        "actions_logged": action_count,
        "processed_at": now,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["diff", "mark-processed"], default="diff")
    parser.add_argument("--rules", type=Path)
    args = parser.parse_args()

    conn = ensure_db()
    if args.mode == "diff":
        scan = run_scan(rules_path=args.rules)
        prev = processed_state(conn)
        new_activity, errors, skipped, unchanged = build_diff(scan, prev)
        update_scanned_state(conn, scan["threads"])
        result = {
            "run_at": utc_now(),
            "new_activity": new_activity,
            "unchanged_count": len(unchanged),
            "skipped_count": len(skipped),
            "error_count": len(errors),
            "errors": errors[:10],
        }
        print(json.dumps(result, indent=2))
        conn.close()
        return 0

    payload = json.load(sys.stdin)
    if not isinstance(payload, list):
        raise SystemExit("Expected JSON array on stdin for --mode mark-processed")
    result = mark_processed(conn, payload)
    print(json.dumps(result, indent=2))
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
