import json
import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from config import DB_PATH
from deps import require_auth
from models import ThemeSave

router = APIRouter()


@router.get("/api/web/themes")
async def list_themes(request: Request):
    require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, name, description, category, tokens, fontFamily, effects, created, updated FROM themes ORDER BY updated DESC")
    rows = c.fetchall()
    conn.close()
    return [{
        "id": r[0], "name": r[1], "description": r[2], "category": r[3],
        "tokens": json.loads(r[4]) if r[4] else {},
        "fontFamily": r[5], "effects": json.loads(r[6]) if r[6] else {},
        "created": r[7], "updated": r[8]
    } for r in rows]


@router.post("/api/web/themes")
async def save_theme(request: Request, body: ThemeSave):
    require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now(timezone.utc).isoformat()
    c.execute("""
        INSERT INTO themes (id, name, description, category, tokens, fontFamily, effects, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, description=excluded.description, category=excluded.category,
            tokens=excluded.tokens, fontFamily=excluded.fontFamily, effects=excluded.effects,
            updated=excluded.updated
    """, (body.id, body.name, body.description, body.category, body.tokens, body.fontFamily, body.effects, now, now))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/api/web/themes/{theme_id}")
async def delete_theme(request: Request, theme_id: str):
    require_auth(request)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM themes WHERE id = ?", (theme_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
