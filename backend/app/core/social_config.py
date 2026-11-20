"""Server-only social integration settings. Values never reach responses, logs or the frontend.

Missing values do not stop the API from starting: the integration reports a
``configuration_required`` state naming the missing *variable names* (never values).
"""
import base64
import binascii
from urllib.parse import urlsplit

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.auth_config import JWT_SECRET, PRODUCTION

# Scopes this integration understands. Only scopes the LinkedIn app has actually been
# granted may be requested: LinkedIn rejects the whole request for an unapproved scope.
KNOWN_LINKEDIN_SCOPES = ("openid", "profile", "email", "w_member_social")
REQUIRED_LINKEDIN_SCOPES = ("openid", "profile")
LOCAL_HOSTS = {"localhost", "127.0.0.1"}


class SocialSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    LINKEDIN_CLIENT_ID: str = ""
    LINKEDIN_CLIENT_SECRET: SecretStr = SecretStr("")
    LINKEDIN_REDIRECT_URI: str = ""
    # Space-separated. Add w_member_social only after LinkedIn grants it to the app.
    LINKEDIN_SCOPES: str = "openid profile email"
    SOCIAL_TOKEN_ENCRYPTION_KEY: SecretStr = SecretStr("")
    SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION: int = 1
    # Decrypt-only keys during rotation: "1:<base64url key>,2:<base64url key>"
    SOCIAL_TOKEN_PREVIOUS_KEYS: SecretStr = SecretStr("")
    SOCIAL_OAUTH_STATE_MINUTES: int = 10

    def linkedin_scopes(self) -> tuple[str, ...]:
        seen: list[str] = []
        for scope in self.LINKEDIN_SCOPES.split():
            if scope not in seen:
                seen.append(scope)
        return tuple(seen)

    def encryption_issues(self) -> list[str]:
        raw = self.SOCIAL_TOKEN_ENCRYPTION_KEY.get_secret_value()
        if not raw:
            return ["SOCIAL_TOKEN_ENCRYPTION_KEY is not set"]
        issues = []
        if decode_key(raw) is None:
            issues.append("SOCIAL_TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64url")
        if raw == JWT_SECRET:
            issues.append("SOCIAL_TOKEN_ENCRYPTION_KEY must not reuse JWT_SECRET")
        if not 1 <= self.SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION <= 32767:
            issues.append("SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION must be between 1 and 32767")
        try:
            previous_keys(self.SOCIAL_TOKEN_PREVIOUS_KEYS.get_secret_value())
        except ValueError:
            issues.append("SOCIAL_TOKEN_PREVIOUS_KEYS must be comma-separated version:key pairs")
        return issues

    def linkedin_issues(self) -> list[str]:
        issues = []
        if not self.LINKEDIN_CLIENT_ID.strip():
            issues.append("LINKEDIN_CLIENT_ID is not set")
        if not self.LINKEDIN_CLIENT_SECRET.get_secret_value():
            issues.append("LINKEDIN_CLIENT_SECRET is not set")
        issues += redirect_issues(self.LINKEDIN_REDIRECT_URI)
        scopes = self.linkedin_scopes()
        unknown = [s for s in scopes if s not in KNOWN_LINKEDIN_SCOPES]
        if unknown:
            issues.append("LINKEDIN_SCOPES contains unsupported scopes: " + ", ".join(unknown))
        missing = [s for s in REQUIRED_LINKEDIN_SCOPES if s not in scopes]
        if missing:
            issues.append("LINKEDIN_SCOPES must include: " + ", ".join(missing))
        return issues + self.encryption_issues()


def decode_key(raw: str) -> bytes | None:
    try:
        key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except (binascii.Error, ValueError):
        return None
    return key if len(key) == 32 else None


def previous_keys(raw: str) -> dict[int, bytes]:
    keys: dict[int, bytes] = {}
    for item in filter(None, (part.strip() for part in raw.split(","))):
        version, _, value = item.partition(":")
        key = decode_key(value.strip())
        if not version.strip().isdigit() or key is None:
            raise ValueError("invalid previous key")
        keys[int(version)] = key
    return keys


def redirect_issues(uri: str) -> list[str]:
    if not uri:
        return ["LINKEDIN_REDIRECT_URI is not set"]
    parts = urlsplit(uri)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ["LINKEDIN_REDIRECT_URI must be an absolute URL"]
    if parts.query or parts.fragment:
        return ["LINKEDIN_REDIRECT_URI must not contain a query string or fragment"]
    if not parts.path.endswith("/social-accounts/oauth/linkedin/callback"):
        return ["LINKEDIN_REDIRECT_URI must point to /api/v1/social-accounts/oauth/linkedin/callback"]
    if parts.scheme != "https" and (PRODUCTION or parts.hostname not in LOCAL_HOSTS):
        return ["LINKEDIN_REDIRECT_URI must use HTTPS outside local development"]
    return []


social_settings = SocialSettings()
