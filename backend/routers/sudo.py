import asyncio
import json
import urllib.request
from datetime import UTC

from fastapi import APIRouter, HTTPException, Request, status
from utils.auth import verify_passphrase, verify_totp
from utils.auth_jwt import mint_sudo_ticket, verify_token
from utils.deps import audit, require_auth
from utils.models import SudoTicketRequest
from utils.ratelimit import get_rate_limiter

from config import PASSPHRASE_HASH, SHELL_URL, TOTP_SECRET

router = APIRouter()


def _proxy_shell(path: str, method: str = "POST", headers: dict = None, data: bytes = None) -> dict:
    """Synchronous proxy to shell microservice."""
    url = f"{SHELL_URL}{path}"
    req = urllib.request.Request(
        url, method=method, data=data, headers=headers or {}, unverifiable=True
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            detail = json.loads(body).get("detail", body)
        except Exception:
            detail = body
        raise HTTPException(status_code=e.code, detail=detail)


def _sudo_rate_limit(key: str) -> bool:
    bucket = get_rate_limiter(f"sudo:{key}", rate=5 / 60, burst=5)
    return bucket.allow()


@router.post("/api/web/tickets/sudo")
async def mint_sudo_ticket_endpoint(request: Request, body: SudoTicketRequest):
    user = require_auth(request)
    ip = request.client.host if request.client else "unknown"

    user_id = user.get("sub", "unknown")
    if not _sudo_rate_limit(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many sudo ticket requests"
        )

    if PASSPHRASE_HASH and not verify_passphrase(body.passphrase, PASSPHRASE_HASH):
        audit("sudo_ticket_fail_passphrase", ip, f"user={user_id}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid passphrase")
    if TOTP_SECRET and not verify_totp(body.totp, TOTP_SECRET):
        audit("sudo_ticket_fail_totp", ip, f"user={user_id}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP")

    ticket = mint_sudo_ticket(user_id)
    audit("sudo_ticket_minted", ip, f"user={user_id}")
    return {
        "ok": True,
        "ticket": ticket,
        "expires_in_seconds": 120,
        "duration_seconds": 120,
    }


@router.post("/api/web/sudo/validate")
async def sudo_validate_proxy(request: Request):
    require_auth(request)
    body = await request.json()
    auth_header = request.headers.get("Authorization", "")
    headers = {"Authorization": auth_header, "Content-Type": "application/json"}
    result = await asyncio.to_thread(
        _proxy_shell, "/sudo/validate", "POST", headers, json.dumps(body).encode()
    )
    return result


@router.post("/api/web/sudo/exec")
async def sudo_exec_proxy(request: Request):
    user = require_auth(request)
    ip = request.client.host if request.client else "unknown"
    user_id = user.get("sub", "unknown")

    bucket = get_rate_limiter(f"sudo_exec:{user_id}", rate=3 / 60, burst=3)
    if not bucket.allow():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many sudo executions"
        )

    body = await request.json()
    ticket = request.headers.get("X-Sudo-Ticket", "")
    if not ticket:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing sudo ticket")

    auth_header = request.headers.get("Authorization", "")
    headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "X-Sudo-Ticket": ticket,
    }
    result = await asyncio.to_thread(
        _proxy_shell, "/sudo/exec", "POST", headers, json.dumps(body).encode()
    )
    audit("sudo_exec", ip, f"user={user_id} cmd={body.get('command','')}")
    return result


@router.get("/api/web/sudo/status")
async def sudo_status(request: Request):
    require_auth(request)
    ticket = request.headers.get("X-Sudo-Ticket", "")
    if not ticket:
        return {"active": False, "expires_in_seconds": None}
    try:
        payload = verify_token(ticket, expected_type="sudo")
        from datetime import datetime

        exp = payload.get("exp")
        if exp:
            expires_in = max(0, int(exp - datetime.now(UTC).timestamp()))
            return {"active": True, "expires_in_seconds": expires_in}
    except Exception:
        pass
    return {"active": False, "expires_in_seconds": None}
