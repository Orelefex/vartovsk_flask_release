"""
Счётчик и аналитика посещений страниц.
Хранит данные в SQLite (visits.db), IP хешируется для приватности.
"""

import hashlib
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from logger_config import setup_logging

logger = setup_logging(__name__)

DB_PATH = Path("visits.db")

_BOTS = ("bot", "crawler", "spider", "slurp", "baiduspider", "facebookexternalhit", "python-requests")

_total_cache: dict = {"value": 0, "expires": 0}


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_visits_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS visits (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ts         TEXT    NOT NULL,
                page       TEXT    NOT NULL,
                ip_hash    TEXT    NOT NULL,
                user_agent TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ts   ON visits(ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_page ON visits(page)")


def _hash_ip(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def is_bot(user_agent: str) -> bool:
    ua = (user_agent or "").lower()
    return any(b in ua for b in _BOTS)


def record_visit(page: str, ip: str, user_agent: str = "") -> None:
    if is_bot(user_agent):
        return
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    ip_hash = _hash_ip((ip or "unknown").split(",")[0].strip())
    ua = (user_agent or "")[:200]
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO visits (ts, page, ip_hash, user_agent) VALUES (?, ?, ?, ?)",
                (ts, page, ip_hash, ua),
            )
        _total_cache["expires"] = 0  # инвалидируем кэш
    except Exception as e:
        logger.warning("Ошибка записи посещения: %s", e)


def get_total_visits() -> int:
    now = time.monotonic()
    if now < _total_cache["expires"]:
        return _total_cache["value"]
    try:
        with _conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0]
        _total_cache["value"] = total
        _total_cache["expires"] = now + 60
        return total
    except Exception:
        return 0


def get_stats() -> dict:
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    month_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")

    page_names = {
        "/":       "Главная (METAR/TAF)",
        "/aero":   "Аэрология",
        "/archive": "Архив",
        "/stats":  "Статистика",
    }

    try:
        with _conn() as conn:
            total        = conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0]
            unique_total = conn.execute("SELECT COUNT(DISTINCT ip_hash) FROM visits").fetchone()[0]

            today_row = conn.execute(
                "SELECT COUNT(*), COUNT(DISTINCT ip_hash) FROM visits WHERE ts >= ?", (today,)
            ).fetchone()
            week_row = conn.execute(
                "SELECT COUNT(*), COUNT(DISTINCT ip_hash) FROM visits WHERE ts >= ?", (week_ago,)
            ).fetchone()
            month_row = conn.execute(
                "SELECT COUNT(*), COUNT(DISTINCT ip_hash) FROM visits WHERE ts >= ?", (month_ago,)
            ).fetchone()

            by_page_rows = conn.execute(
                "SELECT page, COUNT(*) as cnt, COUNT(DISTINCT ip_hash) as uniq "
                "FROM visits GROUP BY page ORDER BY cnt DESC"
            ).fetchall()

            daily_rows = conn.execute("""
                SELECT DATE(ts) as day,
                       COUNT(*) as visits,
                       COUNT(DISTINCT ip_hash) as uniq
                FROM visits
                WHERE ts >= ?
                GROUP BY day
                ORDER BY day
            """, (month_ago,)).fetchall()

            hour_rows = conn.execute("""
                SELECT CAST(SUBSTR(ts, 12, 2) AS INTEGER) as hour,
                       COUNT(*) as cnt
                FROM visits
                GROUP BY hour
                ORDER BY hour
            """).fetchall()

    except Exception as e:
        logger.error("Ошибка чтения статистики: %s", e)
        return {}

    return {
        "total":        total,
        "unique_total": unique_total,
        "today":        {"visits": today_row[0], "unique": today_row[1]},
        "week":         {"visits": week_row[0],  "unique": week_row[1]},
        "month":        {"visits": month_row[0], "unique": month_row[1]},
        "by_page": [
            {
                "page":   page_names.get(r["page"], r["page"]),
                "visits": r["cnt"],
                "unique": r["uniq"],
            }
            for r in by_page_rows
        ],
        "daily": [
            {"day": r["day"], "visits": r["visits"], "unique": r["uniq"]}
            for r in daily_rows
        ],
        "by_hour": [{"hour": r["hour"], "count": r["cnt"]} for r in hour_rows],
    }
