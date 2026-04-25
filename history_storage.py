"""
Локальное хранилище истории METAR на основе SQLite.
Кэширует записи с Ogimet, чтобы не запрашивать их повторно.
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from logger_config import setup_logging

logger = setup_logging(__name__)

DB_PATH = Path("metar_history.db")
CACHE_TTL_HOURS = 1  # записи не устаревают быстрее часа


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Создаёт таблицы при первом запуске."""
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS metar_records (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                icao      TEXT    NOT NULL,
                timestamp TEXT    NOT NULL,
                report_type TEXT  NOT NULL DEFAULT 'METAR',
                raw       TEXT    NOT NULL,
                fetched_at TEXT   NOT NULL,
                UNIQUE(icao, timestamp)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_icao_ts ON metar_records(icao, timestamp)"
        )
    logger.info("БД истории инициализирована: %s", DB_PATH)


def save_records(icao: str, records: list[dict]):
    """
    Сохраняет список METAR-записей.
    records — список словарей с ключами: timestamp, type, message (raw).
    """
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO metar_records
                (icao, timestamp, report_type, raw, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    icao,
                    r["timestamp"],
                    r.get("type", "METAR"),
                    r["message"],
                    now,
                )
                for r in records
            ],
        )
    logger.debug("Сохранено %d записей для %s", len(records), icao)


def get_cached(icao: str, hours: int) -> list[dict] | None:
    """
    Возвращает записи из кэша, если они достаточно свежие.
    Возвращает None, если нужно перезапросить Ogimet.
    """
    cutoff_fetch = (
        datetime.now(timezone.utc) - timedelta(hours=CACHE_TTL_HOURS)
    ).isoformat()
    cutoff_ts = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime(
        "%Y%m%d%H%M"
    )

    with get_conn() as conn:
        # Проверяем, есть ли хотя бы одна свежезагруженная запись
        row = conn.execute(
            """
            SELECT COUNT(*) AS cnt FROM metar_records
            WHERE icao = ? AND fetched_at >= ?
            """,
            (icao, cutoff_fetch),
        ).fetchone()

        if row["cnt"] == 0:
            return None  # кэш устарел

        rows = conn.execute(
            """
            SELECT timestamp, report_type, raw FROM metar_records
            WHERE icao = ? AND timestamp >= ?
            ORDER BY timestamp DESC
            """,
            (icao, cutoff_ts),
        ).fetchall()

    return [
        {"timestamp": r["timestamp"], "type": r["report_type"], "message": r["raw"]}
        for r in rows
    ]


def get_history_range(icao: str, date_from: str, date_to: str) -> list[dict]:
    """
    Возвращает записи за произвольный диапазон (для архива).
    date_from / date_to — строки формата YYYYMMDDHHMM.
    """
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT timestamp, report_type, raw FROM metar_records
            WHERE icao = ? AND timestamp BETWEEN ? AND ?
            ORDER BY timestamp DESC
            """,
            (icao, date_from, date_to),
        ).fetchall()

    return [
        {"timestamp": r["timestamp"], "type": r["report_type"], "message": r["raw"]}
        for r in rows
    ]
