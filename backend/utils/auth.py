import os
import secrets
import time

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16)
serializer = URLSafeTimedSerializer(os.environ.get("JERICHO_SECRET_KEY", secrets.token_hex(32)))

SESSION_MAX_AGE = 900  # 15 minutes idle


def hash_passphrase(passphrase: str) -> str:
    return ph.hash(passphrase)


def verify_passphrase(passphrase: str, hashed: str) -> bool:
    try:
        ph.verify(hashed, passphrase)
        return True
    except VerifyMismatchError:
        return False


def verify_totp(token: str, secret: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)


def create_session(request: Request) -> str:
    data = {
        "ip": request.client.host if request.client else "unknown",
        "nonce": secrets.token_hex(8),
        "created": time.time(),
    }
    return serializer.dumps(data, salt="jericho-session")


def verify_session(request: Request) -> dict:
    cookie = request.cookies.get("jericho_session")
    if not cookie:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No session")
    try:
        data = serializer.loads(cookie, salt="jericho-session", max_age=SESSION_MAX_AGE)
    except SignatureExpired:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except BadSignature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    # Optional: verify IP fingerprint
    current_ip = request.client.host if request.client else "unknown"
    if data.get("ip") != current_ip:
        # Allow Tailscale IPs to roam slightly; strict mode would reject here
        pass
    return data
