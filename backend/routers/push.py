# routers/push.py — Web Push notifications with VAPID
# Pro/Team tier feature for proactive health alerts and agent notifications
import json
import os
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from config import DB_PATH
from utils.auth_jwt import get_auth_from_request
from utils.capabilities import require_capability

router = APIRouter()

VAPID_KEYS_PATH = DB_PATH.parent / "vapid-keys.json"


# ─── VAPID Key Management ────────────────────────────────────────────────────
def _ensure_vapid_keys() -> dict:
    """Generate or load VAPID ECDSA P-256 keypair."""
    if VAPID_KEYS_PATH.exists():
        return json.loads(VAPID_KEYS_PATH.read_text())

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )

    keys = {
        "private_key_pem": private_bytes.decode("utf-8"),
        "public_key_b64": base64url_encode(public_bytes),
        "created_at": datetime.now(UTC).isoformat(),
    }
    VAPID_KEYS_PATH.write_text(json.dumps(keys))
    return keys


def base64url_encode(data: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def get_vapid_public_key() -> str:
    return _ensure_vapid_keys()["public_key_b64"]


# ─── DB ───────────────────────────────────────────────────────────────────────
def _init_push_tables():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(user_id, endpoint)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS push_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            title TEXT,
            body TEXT,
            url TEXT,
            sent_at TEXT,
            delivered INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()


_init_push_tables()


# ─── Pydantic Models ──────────────────────────────────────────────────────────
class PushSubscription(BaseModel):
    endpoint: str
    keys: dict


class PushPayload(BaseModel):
    title: str
    body: str
    url: str = "/"


# ─── API Endpoints ────────────────────────────────────────────────────────────
@router.get("/api/web/push/vapid-public-key")
async def vapid_public_key(request: Request):
    """Return the VAPID public key for client subscription."""
    return {"public_key": get_vapid_public_key()}


@router.post("/api/web/push/subscribe")
async def push_subscribe(payload: PushSubscription, request: Request):
    """Store a Web Push subscription. Pro/Team tier only."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")
    tier = token_data.get("tier", "free")

    if tier not in ("pro", "team"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Push notifications require Pro subscription",
        )

    p256dh = payload.keys.get("p256dh", "")
    auth = payload.keys.get("auth", "")
    if not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Missing subscription keys")

    now = datetime.now(UTC).isoformat()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, endpoint) DO UPDATE SET
            p256dh=excluded.p256dh,
            auth=excluded.auth,
            updated_at=excluded.updated_at
        """,
        (user_id, payload.endpoint, p256dh, auth, now, now),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "subscribed": True}


@router.post("/api/web/push/unsubscribe")
async def push_unsubscribe(payload: PushSubscription, request: Request):
    """Remove a Web Push subscription."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
        (user_id, payload.endpoint),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "unsubscribed": True}


@router.post("/api/web/push/test")
async def push_test(request: Request):
    """Send a test push notification to the current user. Pro/Team only."""
    token_data = get_auth_from_request(request)
    user_id = token_data.get("sub", "anonymous")
    tier = token_data.get("tier", "free")

    if tier not in ("pro", "team"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Push notifications require Pro subscription",
        )

    sent = await _send_push_to_user(
        user_id,
        PushPayload(title="Jericho Test", body="Push notifications are working! 🚀", url="/"),
    )
    return {"ok": True, "sent": sent}


# ─── Push Delivery ────────────────────────────────────────────────────────────
async def _send_push_to_user(user_id: str, payload: PushPayload) -> int:
    """Send push notification to all subscriptions for a user. Returns count sent."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
        (user_id,),
    )
    rows = c.fetchall()
    conn.close()

    if not rows:
        return 0

    keys = _ensure_vapid_keys()
    sent_count = 0

    import asyncio

    for endpoint, p256dh, auth in rows:
        try:
            await _send_web_push(keys, endpoint, p256dh, auth, payload)
            sent_count += 1
        except Exception as e:
            print(f"[push] failed to send to {endpoint}: {e}")
            # TODO: remove stale subscriptions (410 Gone)

    return sent_count


async def _send_web_push(keys: dict, endpoint: str, p256dh: str, auth: str, payload: PushPayload):
    """Send a single Web Push message using pywebpush."""
    from pywebpush import webpush, WebPushException

    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            data=json.dumps({"title": payload.title, "body": payload.body, "url": payload.url}),
            vapid_private_key=keys["private_key_pem"],
            vapid_claims={"sub": "mailto:admin@jericho.local"},
        )
    except WebPushException as e:
        if e.response and e.response.status_code == 410:
            # Subscription expired — should remove from DB
            pass
        raise


# ─── Broadcast (for system alerts) ────────────────────────────────────────────
async def broadcast_push(title: str, body: str, url: str = "/") -> int:
    """Send a push notification to all subscribed users."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT DISTINCT user_id FROM push_subscriptions")
    rows = c.fetchall()
    conn.close()

    total = 0
    for (user_id,) in rows:
        try:
            total += await _send_push_to_user(user_id, PushPayload(title=title, body=body, url=url))
        except Exception as e:
            print(f"[push] broadcast failed for {user_id}: {e}")

    return total
