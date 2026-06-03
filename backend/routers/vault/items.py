from datetime import UTC, datetime

from fastapi import HTTPException, Request, status
from routers.vault import router
from utils.deps import require_auth
from vault.models import VaultItemCreate, VaultItemResponse, VaultItemUpdate

from . import DB_PATH


def _conn():
    import sqlite3

    return sqlite3.connect(DB_PATH)


@router.post("/items", status_code=status.HTTP_201_CREATED)
def vault_create_item(request: Request, item: VaultItemCreate):
    from vault.crypto import generate_id

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    now = datetime.now(UTC).isoformat()
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
            item_id,
            user_id,
            item.type,
            item.name,
            item.data,
            item.folder_id,
            item.favorite,
            item.reprompt,
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return VaultItemResponse(
        id=item_id,
        user_id=user_id,
        organization_id=None,
        type=item.type,
        name=item.name,
        data=item.data,
        folder_id=item.folder_id,
        favorite=item.favorite,
        reprompt=item.reprompt,
        created_at=now,
        updated_at=now,
    )


@router.put("/items/{item_id}")
def vault_update_item(request: Request, item_id: str, item: VaultItemUpdate):

    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    now = datetime.now(UTC).isoformat()

    conn = _conn()
    c = conn.cursor()

    # Verify ownership
    c.execute("SELECT user_id FROM vault_items WHERE id = ?", (item_id,))
    row = c.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

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


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def vault_delete_item(request: Request, item_id: str):
    auth = require_auth(request)
    user_id = auth.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    conn = _conn()
    c = conn.cursor()
    c.execute("SELECT user_id FROM vault_items WHERE id = ?", (item_id,))
    row = c.fetchone()
    if not row or row[0] != user_id:
        conn.close()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    c.execute("DELETE FROM vault_items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
