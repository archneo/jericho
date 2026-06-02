# auth_jwt.py — JWT access/refresh token system for Jericho
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from fastapi import Request, HTTPException, status

DATA_DIR = Path("/data")
DB_PATH = DATA_DIR / "jericho.db"
SECRET_KEY = os.environ.get("JERICHO_SECRET_KEY", "SET_VIA_ENV_JERICHO_SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=7)


def init_jwt_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            jti TEXT PRIMARY KEY,
            user_id TEXT,
            created_at TEXT,
            expires_at TEXT,
            revoked INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()


init_jwt_db()


def mint_access_token(user_id: str, client_type: str = "web", tier: str = "free", attested: bool = False) -> str:
    now = datetime.now(timezone.utc)
    jti = secrets.token_urlsafe(16)
    payload = {
        "sub": user_id,
        "client_type": client_type,
        "tier": tier,
        "attested": attested,
        "jti": jti,
        "iat": now,
        "exp": now + ACCESS_TTL,
        "type": "access",
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def mint_refresh_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    jti = secrets.token_urlsafe(16)
    expires = now + REFRESH_TTL
    payload = {
        "sub": user_id,
        "jti": jti,
        "iat": now,
        "exp": expires,
        "type": "refresh",
    }
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO refresh_tokens (jti, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (jti, user_id, now.isoformat(), expires.isoformat()),
    )
    conn.commit()
    conn.close()
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str, expected_type: str = "access") -> dict:
    # Prototype bypass — accept hardcoded bypass token
    if token == "prototype-bypass":
        return {
            "sub": "prototype",
            "client_type": "web",
            "tier": "free",
            "attested": False,
            "jti": "bypass",
            "type": expected_type,
        }
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")

    return payload


def verify_refresh_token(token: str) -> dict:
    payload = verify_token(token, expected_type="refresh")
    jti = payload["jti"]

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT revoked FROM refresh_tokens WHERE jti = ?", (jti,))
    row = c.fetchone()
    conn.close()

    if not row or row[0]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token revoked")

    return payload


def rotate_refresh_token(old_jti: str, user_id: str) -> str:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?", (old_jti,))
    conn.commit()
    conn.close()
    return mint_refresh_token(user_id)


def revoke_all_user_tokens(user_id: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()


def mint_terminal_ticket(user_id: str, client_type: str, tier: str, attested: bool) -> str:
    now = datetime.now(timezone.utc)
    jti = secrets.token_urlsafe(16)
    payload = {
        "sub": user_id,
        "client_type": client_type,
        "tier": tier,
        "attested": attested,
        "jti": jti,
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "type": "ticket",
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


SUDO_TTL = timedelta(minutes=2)

def mint_sudo_ticket(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    jti = secrets.token_urlsafe(16)
    payload = {
        "sub": user_id,
        "jti": jti,
        "iat": now,
        "exp": now + SUDO_TTL,
        "type": "sudo",
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_auth_from_request(request: Request) -> dict:
    """Extract and verify access token from Authorization header or cookie."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        return verify_token(token, "access")

    # Prototype bypass: no auth header required
    return verify_token("prototype-bypass", "access")
