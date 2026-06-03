"""
Jericho Vault FastAPI Router

Provides zero-knowledge vault endpoints. Server stores encrypted blobs only.
Client must perform all encryption/decryption.
"""

import base64
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from deps import require_auth
from vault.crypto import (
    derive_master_key,
    hash_master_password,
    hash_password_for_storage,
    make_stretched_master_key,
    protect_symmetric_key,
    verify_password_against_storage,
)
from vault.models import (
    VaultChangePasswordRequest,
    VaultFolderCreate,
    VaultFolderResponse,
    VaultItemCreate,
    VaultItemResponse,
    VaultItemUpdate,
    VaultSyncResponse,
    VaultUnlockRequest,
    VaultUnlockResponse,
    VaultUserCreate,
    VaultUserResponse,
)

router = APIRouter(prefix="/vault", tags=["vault"])

DATA_DIR = Path("/data")
DB_PATH = DATA_DIR / "jericho.db"


# ─── DB Helpers ─────────────────────────────────────────────────────────────────

def _conn():
    import sqlite3
    return sqlite3.connect(DB_PATH)


def init_vault_db():
    """Create vault tables if they don't exist."""
    conn = _conn()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS vault_users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            master_password_hash TEXT NOT NULL,
            kdf_type TEXT DEFAULT 'pbkdf2',
            kdf_iterations INTEGER DEFAULT 600000,
            kdf_memory INTEGER DEFAULT 65536,
            kdf_parallelism INTEGER DEFAULT 4,
            protected_symmetric_key TEXT NOT NULL,
            public_key TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS vault_items (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            organization_id TEXT,
            type INTEGER NOT NULL,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            folder_id TEXT,
            favorite INTEGER DEFAULT 0,
            reprompt INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (user_id) REFERENCES vault_users(id),
            FOREIGN KEY (folder_id) REFERENCES vault_folders(id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS vault_folders (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            FOREIGN KEY (user_id) REFERENCES vault_users(id)
        )
    """)
    conn.commit()
    conn.close()


# ─── Auth ───────────────────────────────────────────────────────────────────────

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
    import sqlite3
    from vault.crypto import generate_id, generate_symmetric_key, generate_salt

    user_id = generate_id()
    now = datetime.now(timezone.utc).isoformat()

    # Server-side hash the client-provided password hash with a random salt
    client_hash_bytes = base64.b64decode(req.master_password_hash)
    stored_hash, _ = hash_password_for_storage(client_hash_bytes)

    # Generate a random symmetric key for this user
    # In real usage, the client generates this and sends the protected version.
    # For the API contract, we accept the protected key from the client
    # during a separate "setup" call, or generate one server-side for testing.
    # Here we generate a placeholder that the client will replace.
    symmetric_key = generate_symmetric_key()

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
        raise HTTPException(status_code=409, detail="Email already registered")
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
    import sqlite3

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "SELECT id, master_password_hash FROM vault_users WHERE email = ?",
        (req.email.lower().strip(),),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    user_id, stored_hash = row
    client_hash_bytes = base64.b64decode(req.master_password_hash)
    if not verify_password_against_storage(client_hash_bytes, stored_hash):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid master password")

    now = datetime.now(timezone.utc).isoformat()
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
    import sqlite3

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
        raise HTTPException(status_code=401, detail="Invalid email or password")

    (
        user_id, email, stored_hash, kdf_type, kdf_iterations,
        kdf_memory, kdf_parallelism, protected_symmetric_key, public_key,
        created_at, updated_at,
    ) = row

    client_hash_bytes = base64.b64decode(req.master_password_hash)
    if not verify_password_against_storage(client_hash_bytes, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

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


# ─── Sync ─────────────────────────────────────────────────────────────────────────

@router.get("/sync")
def vault_sync(request: Request):
    """Return all encrypted vault items and folders for the authenticated user.

    Requires either Jericho auth (via deps.require_auth) or vault auth.
    For simplicity, we use the existing Jericho auth and map sub → vault user.
    """
    import sqlite3

    auth = require_auth(request)
    user_sub = auth.get("sub")
    if not user_sub:
        raise HTTPException(status_code=401, detail="Authentication required")

    conn = _conn()
    c = conn.cursor()

    # Get user profile
    c.execute(
        """
        SELECT id, email, kdf_type, kdf_iterations, kdf_memory, kdf_parallelism,
               protected_symmetric_key, public_key, created_at, updated_at
        FROM vault_users WHERE id = ?
        """,
        (user_sub,),
    )
    user_row = c.fetchone()
    if not user_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Vault user not found")

    # Get items
    c.execute(
        """
        SELECT id, user_id, organization_id, type, name, data, folder_id,
               favorite, reprompt, created_at, updated_at
        FROM vault_items WHERE user_id = ?
        ORDER BY updated_at DESC
        """,
        (user_row[0],),
    )
    items = [
        VaultItemResponse(
            id=r[0], user_id=r[1], organization_id=r[2], type=r[3],
            name=r[4], data=r[5], folder_id=r[6], favorite=r[7],
            reprompt=r[8], created_at=r[9], updated_at=r[10],
        )
        for r in c.fetchall()
    ]

    # Get folders
    c.execute(
        """
        SELECT id, user_id, name, created_at, updated_at
        FROM vault_folders WHERE user_id = ?
        ORDER BY name
        """,
        (user_row[0],),
    )
    folders = [
        VaultFolderResponse(
            id=r[0], user_id=r[1], name=r[2],
            created_at=r[3], updated_at=r[4],
        )
        for r in c.fetchall()
    ]

    conn.close()

    return VaultSyncResponse(
        profile=VaultUserResponse(
            id=user_row[0],
            email=user_row[1],
            kdf_type=user_row[2],
            kdf_iterations=user_row[3],
            kdf_memory=user_row[4],
            kdf_parallelism=user_row[5],
            protected_symmetric_key=user_row[6],
            public_key=user_row[7],
            created_at=user_row[8],
            updated_at=user_row[9],
        ),
        items=items,
        folders=folders,
    )


# ─── Items CRUD ───────────────────────────────────────────────────────────────────

@router.post("/items", status_code=status.HTTP_201_CREATED)
def vault_create_item(request: Request, item: VaultItemCreate):
    import sqlite3
    from vault.crypto import generate_id

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    now = datetime.now(timezone.utc).isoformat()
    item_id = generate_id()

    conn = _conn()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO vault_items
        (id, user_id, type, name, data, folder_id, favorite, reprompt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_id, user_id, item.type, item.name, item.data,
            item.folder_id, item.favorite, item.reprompt, now, now,
        ),
    )
    conn.commit()
    conn.close()

    return VaultItemResponse(
        id=item_id, user_id=user_id, organization_id=None, type=item.type,
        name=item.name, data=item.data, folder_id=item.folder_id,
        favorite=item.favorite, reprompt=item.reprompt,
        created_at=now, updated_at=now,
    )


@router.put("/items/{item_id}")
def vault_update_item(request: Request, item_id: str, item: VaultItemUpdate):
    import sqlite3

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    now = datetime.now(timezone.utc).isoformat()

    conn = _conn()
    c = conn.cursor()

    # Verify ownership
    c.execute("SELECT user_id FROM vault_items WHERE id = ?", (item_id,))
    row = c.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=404, detail="Item not found")

    # Build dynamic update
    fields = []
    values = []
    if item.type is not None:
        fields.append("type = ?")
        values.append(item.type)
    if item.name is not None:
        fields.append("name = ?")
        values.append(item.name)
    if item.data is not None:
        fields.append("data = ?")
        values.append(item.data)
    if item.folder_id is not None:
        fields.append("folder_id = ?")
        values.append(item.folder_id)
    if item.favorite is not None:
        fields.append("favorite = ?")
        values.append(item.favorite)
    if item.reprompt is not None:
        fields.append("reprompt = ?")
        values.append(item.reprompt)

    if not fields:
        conn.close()
        raise HTTPException(status_code=400, detail="No fields to update")

    fields.append("updated_at = ?")
    values.append(now)
    values.append(item_id)

    c.execute(
        f"UPDATE vault_items SET {', '.join(fields)} WHERE id = ?",
        values,
    )
    conn.commit()

    # Fetch updated row
    c.execute(
        """
        SELECT id, user_id, organization_id, type, name, data, folder_id,
               favorite, reprompt, created_at, updated_at
        FROM vault_items WHERE id = ?
        """,
        (item_id,),
    )
    r = c.fetchone()
    conn.close()

    return VaultItemResponse(
        id=r[0], user_id=r[1], organization_id=r[2], type=r[3],
        name=r[4], data=r[5], folder_id=r[6], favorite=r[7],
        reprompt=r[8], created_at=r[9], updated_at=r[10],
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def vault_delete_item(request: Request, item_id: str):
    import sqlite3

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    conn = _conn()
    c = conn.cursor()
    c.execute("SELECT user_id FROM vault_items WHERE id = ?", (item_id,))
    row = c.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=404, detail="Item not found")

    c.execute("DELETE FROM vault_items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()


# ─── Folders CRUD ─────────────────────────────────────────────────────────────────

@router.post("/folders", status_code=status.HTTP_201_CREATED)
def vault_create_folder(request: Request, folder: VaultFolderCreate):
    import sqlite3
    from vault.crypto import generate_id

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    now = datetime.now(timezone.utc).isoformat()
    folder_id = generate_id()

    conn = _conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO vault_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (folder_id, user_id, folder.name, now, now),
    )
    conn.commit()
    conn.close()

    return VaultFolderResponse(
        id=folder_id, user_id=user_id, name=folder.name,
        created_at=now, updated_at=now,
    )


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def vault_delete_folder(request: Request, folder_id: str):
    import sqlite3

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    conn = _conn()
    c = conn.cursor()
    c.execute("SELECT user_id FROM vault_folders WHERE id = ?", (folder_id,))
    row = c.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=404, detail="Folder not found")

    # Unlink items from this folder
    c.execute("UPDATE vault_items SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    c.execute("DELETE FROM vault_folders WHERE id = ?", (folder_id,))
    conn.commit()
    conn.close()
