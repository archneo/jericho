# routers/agents/context.py — Unified agent context store
# Persists conversation history, working state, and environment across sessions
import json
import sqlite3
from datetime import UTC, datetime

from fastapi import HTTPException, Request
from pydantic import BaseModel

from config import DB_PATH
from routers.agents import router
from utils.auth_jwt import get_auth_from_request


def _init_context_table():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS agent_contexts (
            context_id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_type TEXT DEFAULT 'chat',
            title TEXT,
            messages_json TEXT DEFAULT '[]',
            working_dir TEXT,
            env_json TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        )
    """)
    c.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_ctx_agent ON agent_contexts(agent_id)
    """)
    c.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_ctx_user ON agent_contexts(user_id)
    """)
    conn.commit()
    conn.close()


_init_context_table()


# ─── Pydantic Models ──────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str
    timestamp: str | None = None
    metadata: dict | None = None


class ContextCreate(BaseModel):
    agent_id: str
    session_type: str = "chat"
    title: str | None = None
    working_dir: str | None = None
    env: dict | None = None


class ContextAppend(BaseModel):
    messages: list[Message]


class ContextUpdate(BaseModel):
    title: str | None = None
    working_dir: str | None = None
    env: dict | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _conn():
    return sqlite3.connect(DB_PATH)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _generate_context_id() -> str:
    import secrets
    return secrets.token_urlsafe(16)


# ─── API Endpoints ────────────────────────────────────────────────────────────
@router.post("/api/web/agents/context")
async def create_context(payload: ContextCreate, request: Request):
    """Create a new agent context session."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    context_id = _generate_context_id()
    now = _now()
    conn = _conn()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO agent_contexts
        (context_id, agent_id, user_id, session_type, title, messages_json, working_dir, env_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            context_id,
            payload.agent_id,
            user_id,
            payload.session_type,
            payload.title,
            json.dumps([]),
            payload.working_dir,
            json.dumps(payload.env or {}),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "context_id": context_id, "created_at": now}


@router.get("/api/web/agents/context/{context_id}")
async def get_context(context_id: str, request: Request):
    """Retrieve a context session with full message history."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "SELECT agent_id, user_id, session_type, title, messages_json, working_dir, env_json, created_at, updated_at "
        "FROM agent_contexts WHERE context_id = ?",
        (context_id,),
    )
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Context not found")

    agent_id, ctx_user_id, session_type, title, messages_json, working_dir, env_json, created_at, updated_at = row
    if ctx_user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "context_id": context_id,
        "agent_id": agent_id,
        "user_id": ctx_user_id,
        "session_type": session_type,
        "title": title,
        "messages": json.loads(messages_json or "[]"),
        "working_dir": working_dir,
        "env": json.loads(env_json or "{}"),
        "created_at": created_at,
        "updated_at": updated_at,
    }


@router.post("/api/web/agents/context/{context_id}/append")
async def append_messages(context_id: str, payload: ContextAppend, request: Request):
    """Append messages to an existing context."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "SELECT user_id, messages_json FROM agent_contexts WHERE context_id = ?",
        (context_id,),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Context not found")

    ctx_user_id, messages_json = row
    if ctx_user_id != user_id:
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")

    existing = json.loads(messages_json or "[]")
    for msg in payload.messages:
        entry = msg.model_dump()
        if not entry.get("timestamp"):
            entry["timestamp"] = _now()
        existing.append(entry)

    now = _now()
    c.execute(
        "UPDATE agent_contexts SET messages_json = ?, updated_at = ? WHERE context_id = ?",
        (json.dumps(existing), now, context_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "message_count": len(existing), "updated_at": now}


@router.patch("/api/web/agents/context/{context_id}")
async def update_context(context_id: str, payload: ContextUpdate, request: Request):
    """Update context metadata (title, working_dir, env)."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "SELECT user_id FROM agent_contexts WHERE context_id = ?",
        (context_id,),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Context not found")
    if row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")

    updates = []
    params = []
    if payload.title is not None:
        updates.append("title = ?")
        params.append(payload.title)
    if payload.working_dir is not None:
        updates.append("working_dir = ?")
        params.append(payload.working_dir)
    if payload.env is not None:
        updates.append("env_json = ?")
        params.append(json.dumps(payload.env))

    if not updates:
        conn.close()
        return {"ok": True, "changed": False}

    updates.append("updated_at = ?")
    params.append(_now())
    params.append(context_id)

    c.execute(
        f"UPDATE agent_contexts SET {', '.join(updates)} WHERE context_id = ?",
        params,
    )
    conn.commit()
    conn.close()
    return {"ok": True, "changed": True}


@router.delete("/api/web/agents/context/{context_id}")
async def delete_context(context_id: str, request: Request):
    """Delete a context session."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "SELECT user_id FROM agent_contexts WHERE context_id = ?",
        (context_id,),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Context not found")
    if row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")

    c.execute("DELETE FROM agent_contexts WHERE context_id = ?", (context_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "deleted": True}


@router.get("/api/web/agents/context")
async def list_contexts(request: Request, agent_id: str | None = None):
    """List all context sessions for the authenticated user."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    conn = _conn()
    c = conn.cursor()
    if agent_id:
        c.execute(
            "SELECT context_id, agent_id, session_type, title, created_at, updated_at "
            "FROM agent_contexts WHERE user_id = ? AND agent_id = ? ORDER BY updated_at DESC",
            (user_id, agent_id),
        )
    else:
        c.execute(
            "SELECT context_id, agent_id, session_type, title, created_at, updated_at "
            "FROM agent_contexts WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        )
    rows = c.fetchall()
    conn.close()

    return {
        "contexts": [
            {
                "context_id": r[0],
                "agent_id": r[1],
                "session_type": r[2],
                "title": r[3],
                "created_at": r[4],
                "updated_at": r[5],
            }
            for r in rows
        ]
    }
