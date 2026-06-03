from datetime import UTC, datetime

from fastapi import HTTPException, Request, status
from routers.vault import router
from utils.deps import require_auth
from vault.models import VaultFolderCreate, VaultFolderResponse

from . import DB_PATH


def _conn():
    import sqlite3

    return sqlite3.connect(DB_PATH)


@router.post("/folders", status_code=status.HTTP_201_CREATED)
def vault_create_folder(request: Request, folder: VaultFolderCreate):
    from vault.crypto import generate_id

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    now = datetime.now(UTC).isoformat()
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
        id=folder_id,
        user_id=user_id,
        name=folder.name,
        created_at=now,
        updated_at=now,
    )


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def vault_delete_folder(request: Request, folder_id: str):
    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    conn = _conn()
    c = conn.cursor()
    c.execute("SELECT user_id FROM vault_folders WHERE id = ?", (folder_id,))
    row = c.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    # Unlink items from this folder
    c.execute("UPDATE vault_items SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    c.execute("DELETE FROM vault_folders WHERE id = ?", (folder_id,))
    conn.commit()
    conn.close()
