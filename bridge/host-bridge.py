#!/usr/bin/env python3
"""
Jericho Host Bridge — runs ON THE HOST (not in Docker).
Spawns and manages Kimi Web UI processes for the Jericho dashboard.
"""
import json
import os
import secrets
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse

DB_PATH = Path("/srv/jericho/data/host-bridge.db")
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
PORT_RANGE = range(11000, 11101)
MAX_CONCURRENT = 10
USER_HOME = os.environ.get("JERICHO_USER_HOME", "/home/YOUR_USER")
KIMI_BIN = os.path.join(USER_HOME, ".local/bin/kimi")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS web_instances (
            port INTEGER PRIMARY KEY,
            uuid TEXT,
            pid INTEGER,
            token TEXT,
            created_at TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

app = FastAPI(title="Jericho Host Bridge")


def get_free_port() -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT port FROM web_instances")
    used = {row[0] for row in c.fetchall()}
    conn.close()
    for port in PORT_RANGE:
        if port not in used:
            # Also check if port is actually free
            try:
                import socket
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.bind(("0.0.0.0", port))
                s.close()
                return port
            except OSError:
                continue
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No free ports available")


def cleanup_dead():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT port, pid FROM web_instances")
    for port, pid in c.fetchall():
        try:
            os.kill(pid, 0)
        except OSError:
            c.execute("DELETE FROM web_instances WHERE port = ?", (port,))
    conn.commit()
    conn.close()


@app.get("/sessions")
def list_sessions():
    """Return all Kimi sessions from filesystem."""
    sessions = []
    base = Path(USER_HOME) / ".kimi/sessions"
    if not base.exists():
        return sessions
    for device_dir in base.iterdir():
        if not device_dir.is_dir():
            continue
        for session_dir in device_dir.iterdir():
            if not session_dir.is_dir():
                continue
            state_path = session_dir / "state.json"
            if not state_path.exists():
                continue
            try:
                state = json.loads(state_path.read_text())
            except Exception:
                continue
            wire_path = session_dir / "wire.jsonl"
            last_active = wire_path.stat().st_mtime if wire_path.exists() else state_path.stat().st_mtime
            todos = state.get("todos", [])
            done = sum(1 for t in todos if t.get("status") == "done")
            sessions.append({
                "uuid": session_dir.name,
                "title": state.get("custom_title") or state.get("plan_slug") or "Untitled",
                "plan_mode": state.get("plan_mode", False),
                "plan_slug": state.get("plan_slug", ""),
                "todo_done": done,
                "todo_total": len(todos),
                "archived": state.get("archived", False),
                "last_active": datetime.fromtimestamp(last_active).isoformat(),
            })
    # Sort by last_active desc
    sessions.sort(key=lambda x: x["last_active"], reverse=True)
    return sessions


@app.post("/launch/{uuid}")
def launch_session(uuid: str):
    cleanup_dead()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM web_instances")
    count = c.fetchone()[0]
    if count >= MAX_CONCURRENT:
        conn.close()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Max concurrent Web UIs reached (5)")
    port = get_free_port()
    token = secrets.token_hex(16)
    cmd = [
        "script", "-q", "-c",
        f"{KIMI_BIN} --session {uuid} web --network --port {port} --no-open --dangerously-omit-auth --public",
        "/dev/null",
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    # Send the interactive confirmation
    try:
        proc.stdin.write(b"I UNDERSTAND THE RISKS\n")
        proc.stdin.close()
    except Exception:
        pass
    c.execute(
        "INSERT INTO web_instances (port, uuid, pid, token, created_at) VALUES (?, ?, ?, ?, ?)",
        (port, uuid, proc.pid, token, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    ts_ip = os.environ.get("TAILSCALE_IP", "127.0.0.1")
    return {"url": f"http://{ts_ip}:{port}", "token": token, "port": port, "pid": proc.pid}


@app.post("/stop/{port}")
def stop_session(port: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT pid FROM web_instances WHERE port = ?", (port,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    pid = row[0]
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(1)
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    except OSError:
        pass
    c.execute("DELETE FROM web_instances WHERE port = ?", (port,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/instances")
def list_instances():
    cleanup_dead()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT port, uuid, pid, created_at FROM web_instances")
    rows = c.fetchall()
    conn.close()
    return [{"port": r[0], "uuid": r[1], "pid": r[2], "created_at": r[3]} for r in rows]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9998)
