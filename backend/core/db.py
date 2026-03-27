from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .config import DB_PATH, DATA_DIR

_LOCK = threading.Lock()
_CONNECTION: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _CONNECTION
    if _CONNECTION is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _CONNECTION = sqlite3.connect(DB_PATH, check_same_thread=False)
        _CONNECTION.row_factory = sqlite3.Row
    return _CONNECTION


def init_db() -> None:
    conn = _connect()
    with _LOCK:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS portfolio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE NOT NULL,
                quantity REAL NOT NULL,
                avg_price REAL NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                condition TEXT NOT NULL,
                threshold REAL NOT NULL,
                active INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                last_triggered_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ohlc (
                ticker TEXT NOT NULL,
                interval TEXT NOT NULL,
                time INTEGER NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL,
                PRIMARY KEY (ticker, interval, time)
            );

            CREATE TABLE IF NOT EXISTS history_meta (
                ticker TEXT NOT NULL,
                interval TEXT NOT NULL,
                last_refresh INTEGER NOT NULL,
                PRIMARY KEY (ticker, interval)
            );

            CREATE TABLE IF NOT EXISTS watchlist (
                ticker TEXT NOT NULL,
                interval TEXT NOT NULL,
                last_seen INTEGER NOT NULL,
                PRIMARY KEY (ticker, interval)
            );

            CREATE TABLE IF NOT EXISTS symbols (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lookup_cache (
                query TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            );
            """
        )
        conn.commit()


def execute(query: str, params: tuple[Any, ...] = ()) -> None:
    conn = _connect()
    with _LOCK:
        conn.execute(query, params)
        conn.commit()


def executemany(query: str, params: list[tuple[Any, ...]]) -> None:
    conn = _connect()
    with _LOCK:
        conn.executemany(query, params)
        conn.commit()


def fetchone(query: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    conn = _connect()
    with _LOCK:
        cur = conn.execute(query, params)
        return cur.fetchone()


def fetchall(query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    conn = _connect()
    with _LOCK:
        cur = conn.execute(query, params)
        return cur.fetchall()


def set_symbols(payload: list[dict], fetched_at: int) -> None:
    execute(
        "INSERT OR REPLACE INTO symbols (id, payload, fetched_at) VALUES (?, ?, ?)",
        ("bist", json.dumps(payload), fetched_at),
    )


def get_symbols() -> tuple[list[dict], int] | None:
    row = fetchone("SELECT payload, fetched_at FROM symbols WHERE id = ?", ("bist",))
    if not row:
        return None
    return json.loads(row["payload"]), int(row["fetched_at"])


def set_lookup(query: str, payload: list[dict], fetched_at: int) -> None:
    execute(
        "INSERT OR REPLACE INTO lookup_cache (query, payload, fetched_at) VALUES (?, ?, ?)",
        (query, json.dumps(payload), fetched_at),
    )


def get_lookup(query: str) -> tuple[list[dict], int] | None:
    row = fetchone(
        "SELECT payload, fetched_at FROM lookup_cache WHERE query = ?",
        (query,),
    )
    if not row:
        return None
    return json.loads(row["payload"]), int(row["fetched_at"])
