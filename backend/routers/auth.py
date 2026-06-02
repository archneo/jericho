from fastapi import APIRouter, Request, HTTPException, status
from fastapi.responses import JSONResponse

from auth import verify_passphrase, verify_totp, create_session
from auth_jwt import (
    mint_access_token,
    mint_refresh_token,
    verify_token,
    verify_refresh_token,
    rotate_refresh_token,
    revoke_all_user_tokens,
)
from capabilities import detect_client_type, get_capabilities
from config import PASSPHRASE_HASH, TOTP_SECRET
from deps import audit
from models import LoginRequest

router = APIRouter()


@router.post("/api/auth/login")
async def login(request: Request, data: LoginRequest):
    ip = request.client.host if request.client else "unknown"
    if not PASSPHRASE_HASH or not verify_passphrase(data.passphrase, PASSPHRASE_HASH):
        audit("login_fail_passphrase", ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid passphrase")
    if not TOTP_SECRET or not verify_totp(data.totp, TOTP_SECRET):
        audit("login_fail_totp", ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP")

    user_id = "user_001"
    client_type = detect_client_type(request)

    access_token = mint_access_token(user_id, client_type=client_type, tier="free", attested=False)
    refresh_token = mint_refresh_token(user_id)

    audit("login_success", ip, f"client_type={client_type}")

    resp = JSONResponse({
        "ok": True,
        "access_token": access_token,
        "client_type": client_type,
        "tier": "free",
        "capabilities": get_capabilities(client_type, "free"),
    })
    secure_cookie = request.url.scheme == "https"
    resp.set_cookie(
        key="jericho_refresh",
        value=refresh_token,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        max_age=60 * 60 * 24 * 7,
    )
    session = create_session(request)
    resp.set_cookie(
        key="jericho_session",
        value=session,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        max_age=900,
    )
    return resp


@router.post("/api/auth/logout")
async def logout(request: Request):
    ip = request.client.host if request.client else "unknown"
    audit("logout", ip)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token_data = verify_token(auth_header[7:], "access")
            revoke_all_user_tokens(token_data["sub"])
        except HTTPException:
            pass
    resp = JSONResponse({"ok": True})
    secure_cookie = request.url.scheme == "https"
    resp.delete_cookie("jericho_refresh", secure=secure_cookie, httponly=True, samesite="strict")
    resp.delete_cookie("jericho_session", secure=secure_cookie, httponly=True, samesite="strict")
    return resp


@router.post("/api/auth/refresh")
async def refresh(request: Request):
    refresh_token = request.cookies.get("jericho_refresh")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    try:
        payload = verify_refresh_token(refresh_token)
        user_id = payload["sub"]
        old_jti = payload["jti"]
        new_refresh = rotate_refresh_token(old_jti, user_id)
        new_access = mint_access_token(user_id)
        resp = JSONResponse({
            "ok": True,
            "access_token": new_access,
        })
        secure_cookie = request.url.scheme == "https"
        resp.set_cookie(
            key="jericho_refresh",
            value=new_refresh,
            httponly=True,
            secure=secure_cookie,
            samesite="strict",
            max_age=60 * 60 * 24 * 7,
        )
        return resp
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")


async def _me_handler(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token_data = verify_token(auth_header[7:], "access")
            return {
                "ok": True,
                "user_id": token_data.get("sub"),
                "client_type": token_data.get("client_type", "web"),
                "tier": token_data.get("tier", "free"),
                "attested": token_data.get("attested", False),
                "capabilities": get_capabilities(
                    token_data.get("client_type", "web"), token_data.get("tier", "free")
                ),
            }
        except HTTPException:
            pass
    try:
        from auth import verify_session
        verify_session(request)
        return {"ok": True, "client_type": "web", "tier": "free"}
    except HTTPException:
        pass
    return {
        "ok": True,
        "user_id": "prototype",
        "client_type": "web",
        "tier": "free",
        "attested": False,
        "capabilities": get_capabilities("web", "free"),
    }


@router.get("/api/me")
async def me(request: Request):
    return await _me_handler(request)


@router.get("/api/web/me")
async def me_web(request: Request):
    return await _me_handler(request)


@router.get("/api/native/me")
async def me_native(request: Request):
    return await _me_handler(request)
