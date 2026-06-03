import base64
import binascii
import sqlite3
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pydantic import BaseModel
from routers.vault import router
from vault.crypto import (
    hash_password_for_storage,
    verify_password_against_storage,
)
from vault.models import (
    VaultUnlockRequest,
    VaultUnlockResponse,
    VaultUserCreate,
    VaultUserResponse,
)

from . import DB_PATH


def _conn():
    import sqlite3

    return sqlite3.connect(DB_PATH)


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def vault_register(req: VaultUserCreate):
    """Register a new vault user.

    Client must send:
      - email
      - master_password_hash (base64 of hashlib.pbkdf2_hmac(master_key, master_password, 1))
      - kdf config

    Server derives nothing; it only stores the provided hash and generates
    a protected symmetric key placeholder (client must provide the actual one).
    """
    from vault.crypto import generate_id

    user_id = generate_id()
    now = datetime.now(UTC).isoformat()

    # Server-side hash the client-provided password hash with a random salt
    try:
        client_hash_bytes = base64.b64decode(req.master_password_hash)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 encoding for master_password_hash"
        )
    stored_hash, _ = hash_password_for_storage(client_hash_bytes)

    # Generate a random symmetric key for this user
    # In real usage, the client generates this and sends the protected version.
    # For the API contract, we accept the protected key from the client
    # during a separate "setup" call, or generate one server-side for testing.
    # Here we generate a placeholder that the client will replace.

    # Derive a temporary master key from a placeholder to protect the symmetric key.
    # In production, the client sends `protected_symmetric_key` directly.
    # For this implementation, we accept it as part of registration.
    # The client must call /vault/auth/setup after registration.
    # SIMPLIFIED: we accept the protected_symmetric_key from the client.
    # If not provided, we generate a placeholder that must be replaced.

    conn = _conn()
    c = conn.cursor()
    try:
        c.execute(
            """
            INSERT INTO vault_users
            (id, email, master_password_hash, kdf_type, kdf_iterations,
             kdf_memory, kdf_parallelism, protected_symmetric_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                req.email,
                stored_hash,
                req.kdf_type,
                req.kdf_iterations,
                req.kdf_memory,
                req.kdf_parallelism,
                "",  # protected_symmetric_key placeholder
                now,
                now,
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        ) from None
    finally:
        conn.close()

    return {
        "id": user_id,
        "email": req.email,
        "created_at": now,
        "message": "Registration successful. Call /vault/auth/setup to set your protected symmetric key.",
    }


class VaultSetupRequest(BaseModel):
    email: str
    master_password_hash: str
    protected_symmetric_key: str


@router.post("/auth/setup")
def vault_setup(req: VaultSetupRequest):
    """Set the protected symmetric key after registration.

    Client derives master key from master password, stretches it,
    generates a random symmetric key, encrypts it with the stretched key,
    and sends the protected result here.
    """

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "SELECT id, master_password_hash FROM vault_users WHERE email = ?",
        (req.email.lower().strip(),),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user_id, stored_hash = row
    try:
        client_hash_bytes = base64.b64decode(req.master_password_hash)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 encoding for master_password_hash"
        )
    if not verify_password_against_storage(client_hash_bytes, stored_hash):
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid master password"
        )

    now = datetime.now(UTC).isoformat()
    c.execute(
        "UPDATE vault_users SET protected_symmetric_key = ?, updated_at = ? WHERE id = ?",
        (req.protected_symmetric_key, now, user_id),
    )
    conn.commit()
    conn.close()
    return {"message": "Protected symmetric key set successfully"}


@router.post("/auth/login")
def vault_login(req: VaultUnlockRequest):
    """Authenticate and return the protected symmetric key.

    Client sends master_password_hash. Server verifies and returns
    the user's profile + protected_symmetric_key.
    """

    conn = _conn()
    c = conn.cursor()
    c.execute(
        """
        SELECT id, email, master_password_hash, kdf_type, kdf_iterations,
               kdf_memory, kdf_parallelism, protected_symmetric_key, public_key,
               created_at, updated_at
        FROM vault_users WHERE email = ?
        """,
        (req.email.lower().strip(),),
    )
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )

    (
        user_id,
        email,
        stored_hash,
        kdf_type,
        kdf_iterations,
        kdf_memory,
        kdf_parallelism,
        protected_symmetric_key,
        public_key,
        created_at,
        updated_at,
    ) = row

    try:
        client_hash_bytes = base64.b64decode(req.master_password_hash)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 encoding for master_password_hash"
        )
    if not verify_password_against_storage(client_hash_bytes, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )

    return VaultUnlockResponse(
        user=VaultUserResponse(
            id=user_id,
            email=email,
            kdf_type=kdf_type,
            kdf_iterations=kdf_iterations,
            kdf_memory=kdf_memory,
            kdf_parallelism=kdf_parallelism,
            protected_symmetric_key=protected_symmetric_key,
            public_key=public_key,
            created_at=created_at,
            updated_at=updated_at,
        ),
        protected_symmetric_key=protected_symmetric_key,
    )
