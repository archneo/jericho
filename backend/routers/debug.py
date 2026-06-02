from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException, status

from config import TOTP_SECRET

router = APIRouter()


@router.get("/api/debug/totp")
async def debug_totp(request: Request):
    """Return current TOTP code for convenience during single-user prototype testing."""
    import pyotp
    if not TOTP_SECRET:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No TOTP configured")
    return {"code": pyotp.TOTP(TOTP_SECRET).now(), "expires_in": 30 - (datetime.now(timezone.utc).second % 30)}
