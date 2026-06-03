import sqlite3

from fastapi import APIRouter, Request
from utils.auth_jwt import verify_token
from utils.deps import require_auth

from config import DB_PATH

router = APIRouter()


@router.get("/api/web/audit")
async def get_audit(request: Request, limit: int = 50):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT ts, event, ip, detail FROM audit ORDER BY id DESC LIMIT ?", (limit,))
    rows = c.fetchall()
    conn.close()
    return [{"ts": r[0], "event": r[1], "ip": r[2], "detail": r[3]} for r in rows]
