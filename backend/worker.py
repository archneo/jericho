# worker.py — Background tasks for Jericho API
# Runs inside FastAPI lifespan context manager
import asyncio
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from config import DB_PATH, AGENTD_URL

# ─── SQLite Cache Helpers ────────────────────────────────────────────────────
def _conn():
    return sqlite3.connect(DB_PATH)


def init_worker_tables():
    conn = _conn()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS dir_cache (
            path TEXT PRIMARY KEY,
            entries_json TEXT,
            updated_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS service_health (
            service TEXT PRIMARY KEY,
            status TEXT,
            checked_at TEXT
        )
    """)
    conn.commit()
    conn.close()


def cache_dir(path: str, entries: list):
    import json
    conn = _conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO dir_cache (path, entries_json, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT(path) DO UPDATE SET entries_json=excluded.entries_json, updated_at=excluded.updated_at",
        (path, json.dumps(entries), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


def get_cached_dir(path: str):
    import json
    conn = _conn()
    c = conn.cursor()
    c.execute("SELECT entries_json, updated_at FROM dir_cache WHERE path = ?", (path,))
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    return json.loads(row[0]), row[1]


def health_record(service: str, status: str):
    conn = _conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO service_health (service, status, checked_at) VALUES (?, ?, ?)"
        " ON CONFLICT(service) DO UPDATE SET status=excluded.status, checked_at=excluded.checked_at",
        (service, status, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


# ─── File System Watcher ─────────────────────────────────────────────────────
class _DirHandler(FileSystemEventHandler):
    def __init__(self, loop):
        self.loop = loop

    def on_any_event(self, event):
        if event.is_directory or event.src_path.startswith('/srv/'):
            # Invalidate parent directory cache
            parent = str(Path(event.src_path).parent)
            if parent.startswith('/srv'):
                asyncio.run_coroutine_threadsafe(_invalidate_dir(parent), self.loop)


async def _invalidate_dir(path: str):
    conn = _conn()
    c = conn.cursor()
    c.execute("DELETE FROM dir_cache WHERE path = ?", (path,))
    conn.commit()
    conn.close()


def start_file_watcher(loop):
    handler = _DirHandler(loop)
    observer = Observer()
    observer.schedule(handler, '/srv', recursive=True)
    observer.start()
    return observer


# ─── Health Pulse ────────────────────────────────────────────────────────────
async def health_pulse():
    import aiohttp
    while True:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                async with session.get(f'{AGENTD_URL}/health') as resp:
                    health_record('agentd', 'up' if resp.status == 200 else 'down')
        except Exception:
            health_record('agentd', 'unreachable')
        await asyncio.sleep(30)


# ─── Bootstrap ───────────────────────────────────────────────────────────────
async def start_background_tasks():
    init_worker_tables()
    loop = asyncio.get_running_loop()
    observer = start_file_watcher(loop)
    task = asyncio.create_task(health_pulse())
    return observer, task


def stop_background_tasks(observer, task):
    observer.stop()
    observer.join()
    task.cancel()
