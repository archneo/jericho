"""
Jericho Vault Pydantic Models

All models enforce input validation. Sensitive fields (encrypted data)
are transmitted as base64 strings.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class VaultUserCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=256)
    master_password_hash: str = Field(..., min_length=1)  # base64-encoded hash from client
    kdf_type: Literal["pbkdf2", "argon2id"] = "pbkdf2"
    kdf_iterations: int = Field(default=600_000, ge=100_000, le=2_000_000)
    kdf_memory: int = Field(default=65536, ge=1024)
    kdf_parallelism: int = Field(default=4, ge=1, le=16)

    @field_validator("email")
    @classmethod
    def email_lowercase(cls, v: str) -> str:
        return v.lower().strip()


class VaultUserLogin(BaseModel):
    email: str
    master_password_hash: str


class VaultUserResponse(BaseModel):
    id: str
    email: str
    kdf_type: str
    kdf_iterations: int
    kdf_memory: int
    kdf_parallelism: int
    protected_symmetric_key: str
    public_key: str | None = None
    created_at: str
    updated_at: str


class VaultSyncResponse(BaseModel):
    profile: VaultUserResponse
    items: list[VaultItemResponse]
    folders: list[VaultFolderResponse]


class VaultItemCreate(BaseModel):
    type: int = Field(..., ge=1, le=4)  # 1=login, 2=secure_note, 3=card, 4=identity
    name: str  # encrypted
    data: str  # encrypted JSON blob
    folder_id: str | None = None
    favorite: int = Field(default=0, ge=0, le=1)
    reprompt: int = Field(default=0, ge=0, le=1)


class VaultItemUpdate(BaseModel):
    type: int | None = Field(default=None, ge=1, le=4)
    name: str | None = None
    data: str | None = None
    folder_id: str | None = None
    favorite: int | None = Field(default=None, ge=0, le=1)
    reprompt: int | None = Field(default=None, ge=0, le=1)


class VaultItemResponse(BaseModel):
    id: str
    user_id: str
    organization_id: str | None = None
    type: int
    name: str
    data: str
    folder_id: str | None = None
    favorite: int
    reprompt: int
    created_at: str
    updated_at: str


class VaultFolderCreate(BaseModel):
    name: str  # encrypted


class VaultFolderResponse(BaseModel):
    id: str
    user_id: str
    name: str
    created_at: str
    updated_at: str


class VaultUnlockRequest(BaseModel):
    email: str
    master_password_hash: str


class VaultUnlockResponse(BaseModel):
    user: VaultUserResponse
    protected_symmetric_key: str


class VaultChangePasswordRequest(BaseModel):
    email: str
    old_master_password_hash: str
    new_master_password_hash: str


# Forward references
VaultSyncResponse.model_rebuild()
