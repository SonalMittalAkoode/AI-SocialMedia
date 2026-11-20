"""Versioned AES-256-GCM encryption for provider credentials.

* The key comes from SOCIAL_TOKEN_ENCRYPTION_KEY (server environment), never the database
  or source, and is required to differ from JWT_SECRET.
* Each value gets a fresh 96-bit nonce; the stored blob is ``nonce || ciphertext+tag``.
* Associated data binds a ciphertext to its social account, field and key version, so a
  blob copied into another row (or tenant) fails authentication instead of decrypting.
* Rotation: deploy the new key with a higher version and list the old one in
  SOCIAL_TOKEN_PREVIOUS_KEYS; ``scripts/rotate_social_token_key.py`` re-encrypts rows.
"""
import os
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.social_config import SocialSettings, decode_key, previous_keys, social_settings

NONCE_BYTES = 12


class CredentialCryptoError(Exception):
    """Raised without key, plaintext or ciphertext detail."""


def _keys(settings: SocialSettings) -> tuple[int, dict[int, bytes]]:
    if settings.encryption_issues():
        raise CredentialCryptoError("Credential encryption is not configured")
    current = settings.SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION
    keys = previous_keys(settings.SOCIAL_TOKEN_PREVIOUS_KEYS.get_secret_value())
    keys[current] = decode_key(settings.SOCIAL_TOKEN_ENCRYPTION_KEY.get_secret_value())
    return current, keys


def _aad(account_id: UUID, field: str, version: int) -> bytes:
    return f"socialai:social_account_credential:{account_id}:{field}:v{version}".encode()


def current_version(settings: SocialSettings | None = None) -> int:
    return _keys(settings or social_settings)[0]


def encrypt(plaintext: str, account_id: UUID, field: str, settings: SocialSettings | None = None) -> tuple[int, bytes]:
    version, keys = _keys(settings or social_settings)
    nonce = os.urandom(NONCE_BYTES)
    sealed = AESGCM(keys[version]).encrypt(nonce, plaintext.encode(), _aad(account_id, field, version))
    return version, nonce + sealed


def decrypt(blob: bytes, version: int, account_id: UUID, field: str, settings: SocialSettings | None = None) -> str:
    _, keys = _keys(settings or social_settings)
    key = keys.get(version)
    if key is None or len(blob) <= NONCE_BYTES:
        raise CredentialCryptoError("Credential key version is unavailable")
    try:
        return AESGCM(key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], _aad(account_id, field, version)).decode()
    except (InvalidTag, UnicodeDecodeError):
        raise CredentialCryptoError("Credential could not be authenticated") from None
