import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from utils.auth_jwt import verify_token
from utils.deps import require_auth
from utils.models import NoteSave

from config import DB_PATH

router = APIRouter()


@router.get("/api/web/notes")
async def list_notes(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT name, updated FROM notes ORDER BY updated DESC")
    rows = c.fetchall()
    conn.close()
    return [{"name": r[0], "updated": r[1]} for r in rows]


@router.get("/api/web/notes/{name}")
async def get_note(request: Request, name: str):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT content FROM notes WHERE name = ?", (name,))
    row = c.fetchone()
    conn.close()
    if not row:
        return {"name": name, "content": "", "updated": ""}
    return {"name": name, "content": row[0], "updated": ""}


@router.post("/api/web/notes/{name}")
async def save_note(request: Request, name: str, body: NoteSave):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now(UTC).isoformat()
    c.execute(
        """
        INSERT INTO notes (name, content, updated) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET content=excluded.content, updated=excluded.updated
    """,
        (name, body.content, now),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/api/web/upload")
async def upload(request: Request, file: UploadFile = File(...), folder: str = "inbox"):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        verify_token(auth_header[7:], "access")
    else:
        require_auth(request)
    dest_dir = Path(f"/srv/{folder}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / file.filename
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"ok": True, "path": str(dest)}
