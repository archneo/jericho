"""
Jericho Vault Cryptography Module

Zero-knowledge vault encryption inspired by Bitwarden architecture.

Server stores encrypted blobs only. All encryption/decryption happens client-side.
Crypto stack:
  - KDF: PBKDF2-SHA256 (default 600k iterations) or Argon2id
  - Key stretching: HKDF-SHA256
  - Encryption: AES-256-CBC
  - MAC: HMAC-SHA256
  - Format: 2.<b64_iv>|<b64_ct>|<b64_mac>
"""

import base64
import hashlib
import hmac
import os
import secrets
import uuid
from typing import Literal

from argon2 import PasswordHasher
from argon2.low_level import Type
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

# ─── Constants ──────────────────────────────────────────────────────────────────
KDF_TYPE_DEFAULT = "pbkdf2"
KDF_ITERATIONS_DEFAULT = 600_000
KDF_MEMORY_DEFAULT = 65536  # KiB for Argon2id
KDF_PARALLELISM_DEFAULT = 4

ENC_KEY_INFO = b"enc"
MAC_KEY_INFO = b"mac"

SYMMETRIC_KEY_SIZE = 64  # 512 bits
MASTER_KEY_SIZE = 32     # 256 bits

# Encrypted string format version
ENCRYPTED_VERSION = "2"


# ─── KDF: PBKDF2 ────────────────────────────────────────────────────────────────
def derive_master_key_pbkdf2(
    master_password: str,
    email: str,
    iterations: int = KDF_ITERATIONS_DEFAULT,
) -> bytes:
    """Derive 256-bit Master Key from master password + email via PBKDF2-SHA256."""
    salt = email.lower().strip().encode("utf-8")
    return hashlib.pbkdf2_hmac(
        "sha256",
        master_password.encode("utf-8"),
        salt,
        iterations,
        dklen=MASTER_KEY_SIZE,
    )


# ─── KDF: Argon2id ──────────────────────────────────────────────────────────────
def derive_master_key_argon2id(
    master_password: str,
    email: str,
    memory: int = KDF_MEMORY_DEFAULT,
    iterations: int = 3,
    parallelism: int = KDF_PARALLELISM_DEFAULT,
) -> bytes:
    """Derive 256-bit Master Key from master password + email via Argon2id.

    Uses argon2.low_level.hash_secret_raw with a fixed 16-byte salt derived
    from the email address (SHA-256 truncated to 16 bytes) for determinism.
    """
    from argon2.low_level import hash_secret_raw

    salt_input = email.lower().strip().encode("utf-8")
    salt = hashlib.sha256(salt_input).digest()[:16]

    raw = hash_secret_raw(
        secret=master_password.encode("utf-8"),
        salt=salt,
        time_cost=iterations,
        memory_cost=memory,
        parallelism=parallelism,
        hash_len=MASTER_KEY_SIZE,
        type=Type.ID,
    )
    return bytes(raw)


def derive_master_key(
    master_password: str,
    email: str,
    kdf_type: Literal["pbkdf2", "argon2id"] = KDF_TYPE_DEFAULT,
    kdf_iterations: int = KDF_ITERATIONS_DEFAULT,
    kdf_memory: int = KDF_MEMORY_DEFAULT,
    kdf_parallelism: int = KDF_PARALLELISM_DEFAULT,
) -> bytes:
    """Derive Master Key using configured KDF."""
    if kdf_type == "pbkdf2":
        return derive_master_key_pbkdf2(master_password, email, kdf_iterations)
    elif kdf_type == "argon2id":
        return derive_master_key_argon2id(
            master_password, email, kdf_memory, kdf_iterations, kdf_parallelism
        )
    else:
        raise ValueError(f"Unsupported KDF type: {kdf_type}")


# ─── Key Stretching: HKDF ───────────────────────────────────────────────────────
def stretch_master_key(master_key: bytes) -> tuple[bytes, bytes]:
    """Stretch 256-bit Master Key into enc_key (256-bit) and mac_key (256-bit) via HKDF-SHA256.

    Returns (enc_key, mac_key).
    """
    hkdf_enc = HKDF(
        algorithm=hashes.SHA256(),
        length=MASTER_KEY_SIZE,
        salt=None,
        info=ENC_KEY_INFO,
    )
    hkdf_mac = HKDF(
        algorithm=hashes.SHA256(),
        length=MASTER_KEY_SIZE,
        salt=None,
        info=MAC_KEY_INFO,
    )
    enc_key = hkdf_enc.derive(master_key)
    mac_key = hkdf_mac.derive(master_key)
    return enc_key, mac_key


def make_stretched_master_key(master_key: bytes) -> bytes:
    """Return the full 512-bit Stretched Master Key (enc_key || mac_key)."""
    enc_key, mac_key = stretch_master_key(master_key)
    return enc_key + mac_key


# ─── Master Password Hash (for server auth) ─────────────────────────────────────
def hash_master_password(master_key: bytes, master_password: str) -> bytes:
    """Hash Master Key with master password for server authentication.

    This is sent to the server during login. The server stores a further
    hashed version of this (with its own salt) for verification.
    """
    return hashlib.pbkdf2_hmac(
        "sha256",
        master_key,
        master_password.encode("utf-8"),
        iterations=1,
        dklen=MASTER_KEY_SIZE,
    )


def hash_password_for_storage(password_hash: bytes, salt: bytes | None = None) -> tuple[str, bytes]:
    """Hash the client-provided password hash with a server-side random salt using PBKDF2.

    Returns (hashed_string_for_storage, salt_used).
    """
    if salt is None:
        salt = os.urandom(32)
    hashed = hashlib.pbkdf2_hmac("sha256", password_hash, salt, iterations=600_000, dklen=32)
    storage = f"pbkdf2_sha256$600000${salt.hex()}${hashed.hex()}"
    return storage, salt


def verify_password_against_storage(password_hash: bytes, stored: str) -> bool:
    """Verify a client-provided password hash against a stored hash."""
    try:
        _, _, salt_hex, expected_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(expected_hex)
        hashed = hashlib.pbkdf2_hmac("sha256", password_hash, salt, iterations=600_000, dklen=32)
        return hmac.compare_digest(expected, hashed)
    except Exception:
        return False


# ─── Symmetric Key Generation ───────────────────────────────────────────────────
def generate_symmetric_key() -> bytes:
    """Generate a random 512-bit Symmetric Key for vault item encryption."""
    return os.urandom(SYMMETRIC_KEY_SIZE)


def protect_symmetric_key(symmetric_key: bytes, stretched_master_key: bytes) -> str:
    """Encrypt the Symmetric Key with the Stretched Master Key.

    Returns an encrypted string in the standard vault format.
    """
    enc_key = stretched_master_key[:MASTER_KEY_SIZE]
    mac_key = stretched_master_key[MASTER_KEY_SIZE:]
    return encrypt(symmetric_key, enc_key, mac_key)


def unprotect_symmetric_key(protected: str, stretched_master_key: bytes) -> bytes:
    """Decrypt the Protected Symmetric Key with the Stretched Master Key."""
    enc_key = stretched_master_key[:MASTER_KEY_SIZE]
    mac_key = stretched_master_key[MASTER_KEY_SIZE:]
    return decrypt(protected, enc_key, mac_key)


# ─── AES-256-CBC + HMAC-SHA256 Encryption ───────────────────────────────────────
def encrypt(plaintext: bytes, enc_key: bytes, mac_key: bytes) -> str:
    """Encrypt plaintext with AES-256-CBC and HMAC-SHA256.

    Returns: "2.<b64_iv>|<b64_ciphertext>|<b64_mac>"
    """
    iv = os.urandom(16)
    cipher = Cipher(algorithms.AES(enc_key), modes.CBC(iv))
    encryptor = cipher.encryptor()

    # PKCS7 padding
    pad_len = 16 - (len(plaintext) % 16)
    padded = plaintext + bytes([pad_len]) * pad_len

    ciphertext = encryptor.update(padded) + encryptor.finalize()

    # HMAC-SHA256 over iv + ciphertext
    mac = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).digest()

    return (
        f"{ENCRYPTED_VERSION}."
        f"{base64.b64encode(iv).decode('ascii')}|"
        f"{base64.b64encode(ciphertext).decode('ascii')}|"
        f"{base64.b64encode(mac).decode('ascii')}"
    )


def decrypt(encrypted: str, enc_key: bytes, mac_key: bytes) -> bytes:
    """Decrypt an encrypted string and verify HMAC.

    Input format: "2.<b64_iv>|<b64_ciphertext>|<b64_mac>"
    """
    try:
        version, payload = encrypted.split(".", 1)
    except ValueError:
        raise ValueError("Invalid encrypted string format: missing version")

    if version != ENCRYPTED_VERSION:
        raise ValueError(f"Unsupported encrypted string version: {version}")

    parts = payload.split("|")
    if len(parts) != 3:
        raise ValueError("Invalid encrypted string format: expected iv|ciphertext|mac")

    iv_b64, ct_b64, mac_b64 = parts
    iv = base64.b64decode(iv_b64)
    ciphertext = base64.b64decode(ct_b64)
    expected_mac = base64.b64decode(mac_b64)

    # Verify HMAC before decryption (constant-time)
    computed_mac = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(expected_mac, computed_mac):
        raise ValueError("MAC verification failed: data may have been tampered with")

    cipher = Cipher(algorithms.AES(enc_key), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()

    # PKCS7 unpadding
    pad_len = padded[-1]
    if pad_len < 1 or pad_len > 16:
        raise ValueError("Invalid padding")
    if padded[-pad_len:] != bytes([pad_len]) * pad_len:
        raise ValueError("Invalid padding")

    return padded[:-pad_len]


# ─── Helpers ──────────────────────────────────────────────────────────────────────
def generate_id() -> str:
    """Generate a cryptographically random vault item ID."""
    return str(uuid.uuid4())


def generate_salt() -> bytes:
    """Generate a random 32-byte salt."""
    return os.urandom(32)


# ─── Re-encryption key rotation ───────────────────────────────────────────────────
def reencrypt_symmetric_key(
    old_protected: str,
    old_stretched_master_key: bytes,
    new_stretched_master_key: bytes,
) -> str:
    """Re-encrypt a Protected Symmetric Key with a new Stretched Master Key (e.g., after password change)."""
    symmetric_key = unprotect_symmetric_key(old_protected, old_stretched_master_key)
    return protect_symmetric_key(symmetric_key, new_stretched_master_key)
