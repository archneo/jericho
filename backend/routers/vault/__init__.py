"""Jericho Vault FastAPI Router.

Provides zero-knowledge vault endpoints. Server stores encrypted blobs only.
Client must perform all encryption/decryption.
"""

from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/vault", tags=["vault"])

DATA_DIR = Path("/data")
DB_PATH = DATA_DIR / "jericho.db"


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


from . import auth, folders, items, sync  # noqa: E402, F401
