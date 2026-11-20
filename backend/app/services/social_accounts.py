"""Social account connection lifecycle (Phase 8A): connect, verify, reconnect, disconnect.

Security model of the OAuth transaction
---------------------------------------
* ``state``: 256-bit random, single use, 10-minute lifetime. Only its SHA-256 is stored;
  consumption is an atomic ``UPDATE ... WHERE consumed_at IS NULL`` so a replay loses.
* Browser binding: a second 256-bit random value is set in an HttpOnly, SameSite=Lax cookie
  scoped to the callback path, and its hash is stored with the state. The callback must
  present it, so a state (or code) injected into another browser is rejected (login-CSRF).
* Session binding: the callback requires the SocialAI session cookie of the *same user*
  that started the flow, and that user must still be an owner/admin of the company.
* The company is locked only after every provider call has finished.
* Redirects go to a fixed frontend path on an origin from FRONTEND_ORIGINS (no open redirect)
  with a fixed outcome code; no token, code or provider text is put in a URL.

No function here publishes, schedules or modifies posts or schedules.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import SQLAlchemyError

from app.core.auth_config import FRONTEND_ORIGINS
from app.core.permissions import company_access, workspace_access
from app.core.social_config import SocialSettings, social_settings
from app.core import token_crypto
from app.models.social_accounts import OAuthAuthorizationState, SocialAccount, SocialAccountCredential
from app.services import linkedin_oauth as linkedin
from app.services.onboarding import transaction

logger = logging.getLogger("socialai.social_accounts")

BINDING_COOKIE_PREFIX = "socialai_oauth_"
CALLBACK_COOKIE_PATH = "/api/v1/social-accounts/oauth"
FRONTEND_RETURN_PATH = "/dashboard/accounts"
REVOKE_GUIDANCE = ("SocialAI deleted its stored LinkedIn credential. LinkedIn does not provide a documented "
                   "token-revocation API, so the authorization remains listed in LinkedIn until you remove it: "
                   "LinkedIn Settings → Data privacy → Permitted services → remove this app.")
SCOPE_CAPABILITIES = {"openid": "verified_identity", "profile": "profile", "email": "email",
                      "w_member_social": "publish_member_posts"}
PUBLISH_SCOPE = "w_member_social"

PLATFORMS = {
    "linkedin": {"platform": "LinkedIn", "description": "Connect a LinkedIn member profile with Sign In with LinkedIn (OpenID Connect)."},
    "instagram": {"platform": "Instagram", "description": "Instagram connections are coming in a later phase."},
    "facebook": {"platform": "Facebook", "description": "Facebook Page connections are coming in a later phase."},
    "x": {"platform": "X", "description": "X connections are coming in a later phase."},
}

# Callback outcome codes (the only values ever placed in the frontend redirect).
OUTCOMES = {"connected", "reconnected", "cancelled", "denied", "invalid_state", "state_expired", "state_reused",
            "session_expired", "session_mismatch", "not_authorized", "wrong_account", "configuration_required",
            "provider_error", "identity_unverified", "storage_error"}


class CallbackFailure(Exception):
    def __init__(self, outcome: str):
        super().__init__(outcome)
        self.outcome = outcome


def now() -> datetime:
    return datetime.now(timezone.utc)


def binding_cookie_name(state_hash: str) -> str:
    # Per-transaction cookie name: concurrent attempts in two tabs do not overwrite each other.
    return BINDING_COOKIE_PREFIX + state_hash[:16]


# ---------------------------------------------------------------- read models

def capabilities_for(scopes) -> list[str]:
    return [SCOPE_CAPABILITIES[s] for s in SCOPE_CAPABILITIES if s in scopes]


def stored_status_for(scopes) -> str:
    return "connected" if PUBLISH_SCOPE in scopes else "limited"


def refresh_available(credential: SocialAccountCredential | None, at: datetime) -> bool:
    return bool(credential and credential.refresh_token_ciphertext is not None
                and (credential.refresh_token_expires_at is None or credential.refresh_token_expires_at > at))


def effective_status(account: SocialAccount, credential: SocialAccountCredential | None, at: datetime | None = None) -> str:
    """Derived only from stored state: no provider call."""
    at = at or now()
    if account.status in ("disconnected", "error", "reconnect_required"):
        return account.status
    if credential is None:
        return "reconnect_required"
    if account.token_expires_at is not None and account.token_expires_at <= at and not refresh_available(credential, at):
        return "reconnect_required"
    return account.status


def serialize(account: SocialAccount, credential: SocialAccountCredential | None, at: datetime | None = None) -> dict:
    at = at or now()
    status = effective_status(account, credential, at)
    return {
        "id": account.id, "company_id": account.company_id, "platform": account.platform,
        "account_type": account.account_type, "display_name": account.display_name, "email": account.email,
        "email_verified": account.email_verified, "avatar_url": account.avatar_url,
        "capabilities": list(account.capabilities or []), "granted_scopes": list(account.granted_scopes or []),
        "status": status,
        "publishing_permission": status in ("connected",) and PUBLISH_SCOPE in (account.granted_scopes or []),
        "refresh_available": refresh_available(credential, at),
        "last_error_code": account.last_error_code, "connected_at": account.connected_at,
        "last_verified_at": account.last_verified_at, "token_expires_at": account.token_expires_at,
        "disconnected_at": account.disconnected_at, "revision": account.revision,
        "created_at": account.created_at, "updated_at": account.updated_at,
    }


def _credential(db, account: SocialAccount):
    return db.scalar(select(SocialAccountCredential).where(
        SocialAccountCredential.social_account_id == account.id, SocialAccountCredential.company_id == account.company_id))


def account_access(db, company_id: UUID, account_id: UUID, lock: bool = False) -> SocialAccount:
    query = select(SocialAccount).where(SocialAccount.id == account_id, SocialAccount.company_id == company_id)
    account = db.scalar(query.with_for_update() if lock else query)
    if account is None:
        raise HTTPException(404, "Social account not found")
    return account


def list_accounts(db, company_id: UUID, include_disconnected: bool = False) -> dict:
    query = select(SocialAccount, SocialAccountCredential).outerjoin(
        SocialAccountCredential, (SocialAccountCredential.social_account_id == SocialAccount.id)
        & (SocialAccountCredential.company_id == SocialAccount.company_id)).where(SocialAccount.company_id == company_id)
    if not include_disconnected:
        query = query.where(SocialAccount.status != "disconnected")
    at = now()
    items = [serialize(a, c, at) for a, c in db.execute(query.order_by(SocialAccount.created_at, SocialAccount.id).limit(100)).all()]
    return {"items": items, "connected_count": sum(i["status"] in ("connected", "limited") for i in items), "publishing_enabled": False}


def account_counts(db, company_id: UUID) -> dict:
    """Used by the CRM overview; derived from stored state only."""
    rows = list_accounts(db, company_id)["items"]
    counts = {s: 0 for s in ("connected", "limited", "reconnect_required", "error")}
    platforms: list[str] = []
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
        if row["status"] in ("connected", "limited") and row["platform"] not in platforms:
            platforms.append(row["platform"])
    return {"total": len(rows), **counts, "connected_platforms": platforms, "publishing_permission": sum(r["publishing_permission"] for r in rows)}


def platform_catalog(settings: SocialSettings | None = None) -> dict:
    settings = settings or social_settings
    items = []
    for slug, meta in PLATFORMS.items():
        if slug == "linkedin":
            issues = settings.linkedin_issues()
            scopes = list(settings.linkedin_scopes())
            items.append({**meta, "slug": slug, "integration": "configuration_required" if issues else "available",
                          "requested_scopes": scopes, "publishing_scope_requested": PUBLISH_SCOPE in scopes,
                          "supports_refresh_tokens": "provider_dependent", "supports_provider_revocation": False,
                          "configuration_issues": issues})
        else:
            items.append({**meta, "slug": slug, "integration": "coming_later", "requested_scopes": [],
                          "publishing_scope_requested": False, "supports_refresh_tokens": "unknown",
                          "supports_provider_revocation": False, "configuration_issues": []})
    return {"items": items, "publishing_enabled": False}


# ---------------------------------------------------------------- start

def _require_linkedin(slug: str, settings: SocialSettings):
    if slug not in PLATFORMS:
        raise HTTPException(404, "Unknown social platform")
    if slug != "linkedin":
        raise HTTPException(409, f"{PLATFORMS[slug]['platform']} connections are not available yet")
    if settings.linkedin_issues():
        raise HTTPException(503, "LinkedIn connection is not configured on this server. An administrator must set the LinkedIn app credentials and token encryption key.")


def start_authorization(db, company, user, slug: str, origin: str | None, target: SocialAccount | None = None,
                        settings: SocialSettings | None = None) -> tuple[dict, str, str, int]:
    """Returns (response body, cookie name, cookie value, cookie max-age seconds)."""
    settings = settings or social_settings
    _require_linkedin(slug, settings)
    if origin not in FRONTEND_ORIGINS:
        # Swagger/API-origin callers can start nothing that would redirect to an unknown place.
        raise HTTPException(403, "Start the connection from the SocialAI application")
    if target is not None and target.platform != "LinkedIn":
        raise HTTPException(409, "This account cannot be reconnected with LinkedIn")
    state, nonce, binding = (secrets.token_urlsafe(32) for _ in range(3))
    minutes = max(1, min(settings.SOCIAL_OAUTH_STATE_MINUTES, 30))
    created = now()
    expires = created + timedelta(minutes=minutes)
    scopes = settings.linkedin_scopes()
    record = OAuthAuthorizationState(
        state_hash=linkedin.digest(state), nonce_hash=linkedin.digest(nonce), binding_hash=linkedin.digest(binding),
        user_id=user.id, company_id=company.id, platform="LinkedIn",
        purpose="reconnect" if target is not None else "connect", target_account_id=target.id if target else None,
        redirect_uri=settings.LINKEDIN_REDIRECT_URI, return_origin=origin, requested_scopes=list(scopes),
        created_at=created, expires_at=expires)
    with transaction(db):
        # Bounded housekeeping: expired transactions are useless; keep a day for replay diagnostics.
        stale = select(OAuthAuthorizationState.id).where(OAuthAuthorizationState.expires_at < created - timedelta(days=1)).limit(500)
        db.execute(delete(OAuthAuthorizationState).where(OAuthAuthorizationState.id.in_(stale)))
        db.add(record)
    logger.info("social_oauth_start company=%s purpose=%s platform=LinkedIn", company.id, record.purpose)
    body = {"authorization_url": linkedin.authorization_url(settings, state, nonce, scopes), "expires_at": expires}
    return body, binding_cookie_name(record.state_hash), binding, minutes * 60


# ---------------------------------------------------------------- callback

def frontend_redirect(origin: str | None, outcome: str, company_id: UUID | None = None, account_id: UUID | None = None) -> str:
    base = origin if origin in FRONTEND_ORIGINS else FRONTEND_ORIGINS[0]
    query = {"social": outcome if outcome in OUTCOMES else "provider_error", "platform": "linkedin"}
    if company_id:
        query["company"] = str(company_id)
    if account_id:
        query["account"] = str(account_id)
    return f"{base}{FRONTEND_RETURN_PATH}?{urlencode(query)}"


def consume_state(db, state: str | None) -> OAuthAuthorizationState:
    if not state or len(state) > 200:
        raise CallbackFailure("invalid_state")
    state_hash = linkedin.digest(state)
    try:
        record = db.scalars(update(OAuthAuthorizationState)
                            .where(OAuthAuthorizationState.state_hash == state_hash, OAuthAuthorizationState.consumed_at.is_(None))
                            .values(consumed_at=now()).returning(OAuthAuthorizationState)
                            .execution_options(synchronize_session=False)).one_or_none()
        if record is None:
            reused = db.scalar(select(OAuthAuthorizationState.id).where(OAuthAuthorizationState.state_hash == state_hash))
            db.rollback()
            raise CallbackFailure("state_reused" if reused else "invalid_state")
        db.commit()  # the state is spent before any provider call
    except SQLAlchemyError:
        db.rollback()
        raise CallbackFailure("storage_error") from None
    if record.expires_at <= now():
        raise CallbackFailure("state_expired")
    return record


def handle_callback(db, params: dict, user, binding_cookies: dict, settings: SocialSettings | None = None) -> tuple[str, str]:
    """Returns (frontend redirect URL, binding cookie name to clear)."""
    settings = settings or social_settings
    record = None
    cookie_name = ""
    try:
        record = consume_state(db, params.get("state"))
        cookie_name = binding_cookie_name(record.state_hash)
        binding = binding_cookies.get(cookie_name)
        if not binding or not secrets.compare_digest(linkedin.digest(binding), record.binding_hash):
            raise CallbackFailure("session_mismatch")
        if user is None:
            raise CallbackFailure("session_expired")
        if user.id != record.user_id:
            raise CallbackFailure("session_mismatch")
        if params.get("error"):
            raise CallbackFailure("cancelled" if params["error"] in linkedin.CANCELLED_ERRORS else "denied")
        code = params.get("code")
        if not code or len(code) > 2048:
            raise CallbackFailure("invalid_state")
        if settings.linkedin_issues():
            raise CallbackFailure("configuration_required")
        if record.redirect_uri != settings.LINKEDIN_REDIRECT_URI:
            raise CallbackFailure("configuration_required")
        account = complete_connection(db, record, user, code, settings)
        outcome = "reconnected" if record.purpose == "reconnect" else "connected"
        logger.info("social_oauth_callback company=%s outcome=%s account=%s", record.company_id, outcome, account.id)
        return frontend_redirect(record.return_origin, outcome, record.company_id, account.id), cookie_name
    except SQLAlchemyError:
        db.rollback()
        logger.warning("social_oauth_callback company=%s outcome=storage_error", record.company_id if record else "-")
        return frontend_redirect(record.return_origin if record else None, "storage_error",
                                 record.company_id if record else None), cookie_name
    except CallbackFailure as failure:
        logger.warning("social_oauth_callback company=%s outcome=%s", record.company_id if record else "-", failure.outcome)
        return frontend_redirect(record.return_origin if record else None, failure.outcome,
                                 record.company_id if record else None, record.target_account_id if record else None), cookie_name


def complete_connection(db, record: OAuthAuthorizationState, user, code: str, settings: SocialSettings) -> SocialAccount:
    # 1. Provider calls, with no database lock held.
    try:
        tokens = linkedin.exchange_code(settings, code, record.redirect_uri)
        if not tokens.id_token:
            raise linkedin.LinkedInError("identity_unverified")
        claims = linkedin.validate_id_token(settings, tokens.id_token, record.nonce_hash)
        identity = linkedin.userinfo(tokens.access_token)
    except linkedin.LinkedInError as error:
        raise CallbackFailure("identity_unverified" if error.code == "identity_unverified" else "provider_error") from None
    if identity.subject != claims["sub"]:
        raise CallbackFailure("identity_unverified")
    # Granted scopes come from the token response; LinkedIn returns them on every exchange.
    scopes = list(tokens.scopes) or [s for s in record.requested_scopes if s in ("openid",)]
    at = now()
    # 2. Re-authorize against current membership and lock the company (company → account order).
    try:
        try:
            company = company_access(db, user, record.company_id, write=True)
        except HTTPException:
            db.rollback()
            raise CallbackFailure("not_authorized") from None
        account = db.scalar(select(SocialAccount).where(
            SocialAccount.company_id == company.id, SocialAccount.platform == "LinkedIn",
            SocialAccount.provider_account_id == identity.subject).with_for_update())
        if record.purpose == "reconnect" and (account is None or account.id != record.target_account_id):
            db.rollback()
            raise CallbackFailure("wrong_account")
        with transaction(db):
            if account is None:
                account = SocialAccount(id=uuid4(), company_id=company.id, platform="LinkedIn",
                                        provider_account_id=identity.subject, account_type="person",
                                        connected_by=user.id, connected_at=at)
                db.add(account)
            account.display_name = identity.name
            account.email = identity.email
            account.email_verified = identity.email_verified
            account.avatar_url = identity.picture
            account.granted_scopes = scopes
            account.capabilities = capabilities_for(scopes)
            account.status = stored_status_for(scopes)
            account.last_error_code = None
            account.connected_at = at
            account.last_verified_at = at
            account.disconnected_at = None
            account.disconnected_by = None
            account.token_expires_at = at + timedelta(seconds=tokens.expires_in) if tokens.expires_in else None
            account.refresh_token_expires_at = (at + timedelta(seconds=tokens.refresh_expires_in)
                                                if tokens.refresh_token and tokens.refresh_expires_in else None)
            db.flush()
            store_credential(db, account, tokens, scopes)
        return account
    except token_crypto.CredentialCryptoError:
        db.rollback()
        raise CallbackFailure("configuration_required") from None
    except HTTPException:
        raise CallbackFailure("storage_error") from None


def store_credential(db, account: SocialAccount, tokens: linkedin.TokenSet, scopes: list[str]) -> SocialAccountCredential:
    """Replace the account's credential. Refresh tokens are stored only when LinkedIn sent one."""
    version, access_blob = token_crypto.encrypt(tokens.access_token, account.id, "access_token")
    refresh_blob = None
    if tokens.refresh_token:
        _, refresh_blob = token_crypto.encrypt(tokens.refresh_token, account.id, "refresh_token")
    credential = _credential(db, account) or SocialAccountCredential(social_account_id=account.id, company_id=account.company_id)
    credential.key_version = version
    credential.access_token_ciphertext = access_blob
    credential.refresh_token_ciphertext = refresh_blob
    credential.refresh_token_expires_at = account.refresh_token_expires_at if refresh_blob else None
    credential.granted_scopes = scopes
    credential.access_token_expires_at = account.token_expires_at
    db.add(credential)
    return credential


# ---------------------------------------------------------------- disconnect

def disconnect(db, company, user, account_id: UUID) -> dict:
    account = account_access(db, company.id, account_id, lock=True)
    if account.status == "disconnected":  # idempotent replay
        db.rollback()
        return {"account": serialize(account, None), "provider_access_revoked": False, "guidance": REVOKE_GUIDANCE}
    with transaction(db):
        db.execute(delete(SocialAccountCredential).where(
            SocialAccountCredential.social_account_id == account.id, SocialAccountCredential.company_id == company.id))
        db.execute(delete(OAuthAuthorizationState).where(
            OAuthAuthorizationState.target_account_id == account.id, OAuthAuthorizationState.consumed_at.is_(None)))
        account.status = "disconnected"
        account.disconnected_at = now()
        account.disconnected_by = user.id
        account.token_expires_at = None
        account.refresh_token_expires_at = None
        account.last_error_code = None
    logger.info("social_account_disconnect company=%s account=%s", company.id, account.id)
    return {"account": serialize(account, None), "provider_access_revoked": False, "guidance": REVOKE_GUIDANCE}


# ---------------------------------------------------------------- explicit provider verification

def verify(db, user, company_id: UUID, account_id: UUID, settings: SocialSettings | None = None) -> dict:
    """User-triggered check through LinkedIn token introspection (one provider call, or two
    when an expired token can be refreshed with a provider-issued refresh token)."""
    settings = settings or social_settings
    company = company_access(db, user, company_id)
    workspace_access(db, user, company.workspace_id, write=True)
    account = account_access(db, company_id, account_id)
    if account.status == "disconnected":
        raise HTTPException(409, "This account is disconnected. Connect it again to use it.")
    if settings.linkedin_issues():
        raise HTTPException(503, "LinkedIn connection is not configured on this server.")
    credential = _credential(db, account)
    if credential is None:
        raise HTTPException(409, "Reconnect this account to restore its credential.")
    credential_id, credential_updated = credential.id, credential.updated_at
    db.rollback()  # release the read snapshot; no lock is held during provider calls
    updates: dict = {}
    refreshed: linkedin.TokenSet | None = None
    try:
        access = token_crypto.decrypt(credential.access_token_ciphertext, credential.key_version, account.id, "access_token", settings)
        result = linkedin.introspect(settings, access)
        if result["active"]:
            updates = {"status_scopes": linkedin.parse_scopes(result.get("scope")), "expires_at": result.get("expires_at"), "error": None}
        elif result.get("status") == "expired" and refresh_available(credential, now()):
            refresh = token_crypto.decrypt(credential.refresh_token_ciphertext, credential.key_version, account.id, "refresh_token", settings)
            refreshed = linkedin.refresh_access_token(settings, refresh)
            updates = {"status_scopes": refreshed.scopes, "error": None}
        else:
            updates = {"error": "token_revoked" if result.get("status") == "revoked" else "token_expired"}
    except token_crypto.CredentialCryptoError:
        updates = {"error": "credential_unreadable", "status": "error"}
    except linkedin.LinkedInError as error:
        if error.code == "grant_rejected" and refreshed is None and updates == {}:
            # The refresh grant itself was refused: a confirmed provider rejection.
            updates = {"error": "token_expired"}
        else:
            logger.warning("social_account_verify company=%s account=%s provider=%s", company_id, account_id, error.code)
            raise HTTPException(502, "LinkedIn could not be reached to verify this connection. Its saved status is unchanged.") from None
    company = company_access(db, user, company_id, write=True)
    account = account_access(db, company_id, account_id, lock=True)
    credential = _credential(db, account)
    if account.status == "disconnected" or credential is None or credential.id != credential_id or credential.updated_at != credential_updated:
        db.rollback()  # reconnected/disconnected meanwhile: do not overwrite newer state
        raise HTTPException(409, "This connection changed in another session. Reload and try again.")
    at = now()
    with transaction(db):
        if refreshed is not None:
            account.token_expires_at = at + timedelta(seconds=refreshed.expires_in) if refreshed.expires_in else None
            if refreshed.refresh_token:
                if refreshed.refresh_expires_in:
                    account.refresh_token_expires_at = at + timedelta(seconds=refreshed.refresh_expires_in)
            else:  # keep the existing refresh token; LinkedIn's TTL does not reset
                refreshed = linkedin.TokenSet(refreshed.access_token, refreshed.expires_in, refreshed.scopes,
                                              token_crypto.decrypt(credential.refresh_token_ciphertext, credential.key_version, account.id, "refresh_token", settings),
                                              None, refreshed.id_token)
            store_credential(db, account, refreshed, list(refreshed.scopes or account.granted_scopes))
        if updates.get("error"):
            account.last_error_code = updates["error"]
            account.status = updates.get("status", "reconnect_required")
        else:
            scopes = list(updates.get("status_scopes") or account.granted_scopes)
            account.granted_scopes = scopes
            account.capabilities = capabilities_for(scopes)
            account.status = stored_status_for(scopes)
            account.last_error_code = None
            account.last_verified_at = at
            expires_at = updates.get("expires_at")
            if isinstance(expires_at, int) and not isinstance(expires_at, bool) and expires_at > 0:
                account.token_expires_at = datetime.fromtimestamp(expires_at, timezone.utc)
            credential = _credential(db, account)
            credential.granted_scopes = scopes
            credential.access_token_expires_at = account.token_expires_at
    logger.info("social_account_verify company=%s account=%s status=%s", company_id, account_id, account.status)
    return status_payload(account, _credential(db, account), provider_checked=True)


def status_payload(account: SocialAccount, credential, provider_checked: bool = False) -> dict:
    at = now()
    data = serialize(account, credential, at)
    return {"id": account.id, "status": data["status"], "publishing_permission": data["publishing_permission"],
            "refresh_available": data["refresh_available"], "token_expires_at": account.token_expires_at,
            "last_verified_at": account.last_verified_at, "last_error_code": account.last_error_code,
            "checked_at": at, "provider_checked": provider_checked}


def credential_for(db, account: SocialAccount):
    return _credential(db, account)
