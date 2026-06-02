from fastapi import APIRouter, Request, HTTPException, status

from auth_jwt import verify_token

router = APIRouter()


@router.post("/api/native/push/register")
async def native_push_register(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    if token_data.get("tier") not in ("pro", "team"):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Push notifications require Pro subscription")
    return {"ok": True, "stub": True}


@router.post("/api/native/sync/offline")
async def native_sync_offline(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    if token_data.get("tier") not in ("pro", "team"):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Offline sync requires Pro subscription")
    return {"ok": True, "stub": True}


@router.post("/api/native/biometric")
async def native_biometric(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    if token_data.get("tier") not in ("pro", "team"):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Biometric unlock requires Pro subscription")
    return {"ok": True, "stub": True}
