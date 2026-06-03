from fastapi import HTTPException, Request, status
from routers.vault import router
from utils.deps import require_auth
from vault.models import (
    VaultFolderResponse,
    VaultItemResponse,
    VaultSyncResponse,
    VaultUserResponse,
)

from . import DB_PATH


def _conn():
    import sqlite3

    return sqlite3.connect(DB_PATH)


@router.get("/sync")
def vault_sync(request: Request):
    """Return all encrypted vault items and folders for the authenticated user.

    Requires either Jericho auth (via deps.require_auth) or vault auth.
    For simplicity, we use the existing Jericho auth and map sub → vault user.
    """
    auth = require_auth(request)
    user_sub = auth.get("sub")
    if not user_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vault user not found")

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
            id=r[0],
            user_id=r[1],
            organization_id=r[2],
            type=r[3],
            name=r[4],
            data=r[5],
            folder_id=r[6],
            favorite=r[7],
            reprompt=r[8],
            created_at=r[9],
            updated_at=r[10],
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
            id=r[0],
            user_id=r[1],
            name=r[2],
            created_at=r[3],
            updated_at=r[4],
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
