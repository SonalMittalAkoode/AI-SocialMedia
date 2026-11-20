"""LinkedIn OAuth 2.0 authorization-code + OpenID Connect client (server side only).

Endpoints are the documented ones (Microsoft Learn, LinkedIn authorization-code flow,
Sign In with LinkedIn using OpenID Connect, token introspection, reviewed Nov 2026).
Provider response bodies, tokens and secrets are never logged or included in errors:
every failure is reduced to a fixed ``LinkedInError.code``.

Notes on documented provider behaviour this client relies on:
* Confidential web client: the code is exchanged with ``client_secret``. LinkedIn does not
  document PKCE for web apps, so no ``code_challenge`` is sent.
* ``nonce`` is not documented by LinkedIn. It is sent (standard OIDC) and enforced when the
  ID token echoes it; CSRF/replay protection does not depend on it (see social_accounts).
* Refresh tokens are issued only to approved Marketing Developer Platform partners.
* LinkedIn documents no token-revocation endpoint; introspection is documented.
"""
import hashlib
import hmac
import time
from dataclasses import dataclass
from urllib.parse import quote, urlencode, urlsplit

import httpx
import jwt

from app.core.social_config import SocialSettings

AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
INTROSPECT_URL = "https://www.linkedin.com/oauth/v2/introspectToken"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
JWKS_URL = "https://www.linkedin.com/oauth/openid/jwks"
# The discovery document publishes https://www.linkedin.com/oauth; the reference table lists
# https://www.linkedin.com. Both are LinkedIn-controlled issuers; anything else is rejected.
ISSUERS = ("https://www.linkedin.com/oauth", "https://www.linkedin.com")
CANCELLED_ERRORS = {"user_cancelled_login", "user_cancelled_authorize"}
MAX_TOKEN_LENGTH = 8192

# Tests substitute an httpx.MockTransport; production uses the default network transport.
transport: httpx.BaseTransport | None = None
_jwks_cache: dict = {"keys": None, "fetched": 0.0}


class LinkedInError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class TokenSet:
    access_token: str
    expires_in: int | None
    scopes: tuple[str, ...]
    refresh_token: str | None
    refresh_expires_in: int | None
    id_token: str | None

    def __repr__(self):  # never print secrets, even in tracebacks/debuggers
        return f"TokenSet(scopes={self.scopes}, expires_in={self.expires_in}, refresh={'yes' if self.refresh_token else 'no'})"


@dataclass(frozen=True)
class Identity:
    subject: str
    name: str | None
    email: str | None
    email_verified: bool | None
    picture: str | None


def parse_scopes(value) -> tuple[str, ...]:
    if not isinstance(value, str):
        return ()
    out: list[str] = []
    for scope in value.replace(",", " ").split():
        if scope not in out:
            out.append(scope)
    return tuple(out)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _client() -> httpx.Client:
    return httpx.Client(transport=transport, timeout=httpx.Timeout(10.0), follow_redirects=False,
                        headers={"User-Agent": "SocialAI/1.0", "Accept": "application/json"})


def authorization_url(settings: SocialSettings, state: str, nonce: str, scopes: tuple[str, ...]) -> str:
    query = urlencode({
        "response_type": "code",
        "client_id": settings.LINKEDIN_CLIENT_ID,
        "redirect_uri": settings.LINKEDIN_REDIRECT_URI,
        "state": state,
        "scope": " ".join(scopes),
        "nonce": nonce,
    }, quote_via=quote)
    return f"{AUTHORIZE_URL}?{query}"


def _post_form(url: str, data: dict) -> dict:
    try:
        with _client() as client:
            response = client.post(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    except httpx.HTTPError:
        raise LinkedInError("provider_unavailable") from None
    if response.status_code == 401:
        raise LinkedInError("client_rejected")
    if response.status_code >= 500:
        raise LinkedInError("provider_unavailable")
    if response.status_code != 200:
        raise LinkedInError("grant_rejected")
    try:
        body = response.json()
    except ValueError:
        raise LinkedInError("invalid_provider_response") from None
    if not isinstance(body, dict):
        raise LinkedInError("invalid_provider_response")
    return body


def _positive_int(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _token_set(body: dict) -> TokenSet:
    access = body.get("access_token")
    if not isinstance(access, str) or not access or len(access) > MAX_TOKEN_LENGTH:
        raise LinkedInError("invalid_provider_response")
    refresh = body.get("refresh_token")
    refresh = refresh if isinstance(refresh, str) and 0 < len(refresh) <= MAX_TOKEN_LENGTH else None
    id_token = body.get("id_token")
    return TokenSet(
        access_token=access,
        expires_in=_positive_int(body.get("expires_in")),
        scopes=parse_scopes(body.get("scope")),
        refresh_token=refresh,
        refresh_expires_in=_positive_int(body.get("refresh_token_expires_in")) if refresh else None,
        id_token=id_token if isinstance(id_token, str) and id_token else None,
    )


def exchange_code(settings: SocialSettings, code: str, redirect_uri: str) -> TokenSet:
    return _token_set(_post_form(TOKEN_URL, {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": settings.LINKEDIN_CLIENT_ID,
        "client_secret": settings.LINKEDIN_CLIENT_SECRET.get_secret_value(),
        "redirect_uri": redirect_uri,
    }))


def refresh_access_token(settings: SocialSettings, refresh_token: str) -> TokenSet:
    return _token_set(_post_form(TOKEN_URL, {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": settings.LINKEDIN_CLIENT_ID,
        "client_secret": settings.LINKEDIN_CLIENT_SECRET.get_secret_value(),
    }))


def introspect(settings: SocialSettings, token: str) -> dict:
    body = _post_form(INTROSPECT_URL, {
        "client_id": settings.LINKEDIN_CLIENT_ID,
        "client_secret": settings.LINKEDIN_CLIENT_SECRET.get_secret_value(),
        "token": token,
    })
    if not isinstance(body.get("active"), bool):
        raise LinkedInError("invalid_provider_response")
    return body


def _jwks(force: bool = False) -> list:
    fresh = time.monotonic() - _jwks_cache["fetched"] < 3600
    if _jwks_cache["keys"] is not None and fresh and not force:
        return _jwks_cache["keys"]
    try:
        with _client() as client:
            response = client.get(JWKS_URL)
        keys = response.json().get("keys") if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError, AttributeError):
        keys = None
    if not isinstance(keys, list):
        raise LinkedInError("provider_unavailable")
    _jwks_cache.update(keys=keys, fetched=time.monotonic())
    return keys


def _signing_key(kid: str | None):
    for force in (False, True):  # refetch once for key rotation
        if force and time.monotonic() - _jwks_cache["fetched"] < 60:
            break
        for item in _jwks(force):
            if isinstance(item, dict) and item.get("kid") == kid and item.get("kty") == "RSA":
                try:
                    return jwt.PyJWK(item, algorithm="RS256").key
                except jwt.PyJWTError:
                    raise LinkedInError("identity_unverified") from None
    raise LinkedInError("identity_unverified")


def validate_id_token(settings: SocialSettings, id_token: str, nonce_hash: str) -> dict:
    """Verify signature (RS256, LinkedIn JWKS), issuer, audience, expiry and nonce."""
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError:
        raise LinkedInError("identity_unverified") from None
    if header.get("alg") != "RS256":
        raise LinkedInError("identity_unverified")
    key = _signing_key(header.get("kid"))
    try:
        claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=settings.LINKEDIN_CLIENT_ID,
                            issuer=ISSUERS, leeway=60, options={"require": ["iss", "sub", "aud", "exp", "iat"]})
    except jwt.PyJWTError:
        raise LinkedInError("identity_unverified") from None
    if not isinstance(claims.get("sub"), str) or not claims["sub"] or len(claims["sub"]) > 255:
        raise LinkedInError("identity_unverified")
    if "nonce" in claims and not (isinstance(claims["nonce"], str) and hmac.compare_digest(digest(claims["nonce"]), nonce_hash)):
        raise LinkedInError("identity_unverified")
    return claims


def _https_url(value) -> str | None:
    if isinstance(value, str) and len(value) <= 2000:
        parts = urlsplit(value)
        if parts.scheme == "https" and parts.hostname:
            return value
    return None


def userinfo(access_token: str) -> Identity:
    try:
        with _client() as client:
            response = client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    except httpx.HTTPError:
        raise LinkedInError("provider_unavailable") from None
    if response.status_code in (401, 403):
        raise LinkedInError("identity_unverified")
    if response.status_code != 200:
        raise LinkedInError("provider_unavailable")
    try:
        body = response.json()
    except ValueError:
        raise LinkedInError("invalid_provider_response") from None
    if not isinstance(body, dict) or not isinstance(body.get("sub"), str) or not body["sub"]:
        raise LinkedInError("identity_unverified")
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        parts = [body.get(k) for k in ("given_name", "family_name")]
        name = " ".join(p for p in parts if isinstance(p, str) and p.strip()) or None
    email = body.get("email") if isinstance(body.get("email"), str) and "@" in body.get("email", "") else None
    verified = body.get("email_verified") if isinstance(body.get("email_verified"), bool) else None
    return Identity(subject=body["sub"], name=name.strip()[:300] if name else None,
                    email=email[:320] if email else None, email_verified=verified if email else None,
                    picture=_https_url(body.get("picture")))
