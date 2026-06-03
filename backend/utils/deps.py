import sqlite3
from datetime import UTC, datetime

from fastapi import Request
from utils.auth import verify_session
from utils.auth_jwt import verify_token

from config import DB_PATH


def require_auth(request: Request):
    """Verify Bearer token or session; raise 401 if neither present."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return verify_token(auth_header[7:], "access")
    return verify_session(request)


def audit(event: str, ip: str, detail: str = ""):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO audit (ts, event, ip, detail) VALUES (?, ?, ?, ?)",
        (datetime.now(UTC).isoformat(), event, ip, detail),
    )
    conn.commit()
    conn.close()
