"""Phase 8A social account connections, against a mocked LinkedIn (httpx.MockTransport).

The fake provider signs real RS256 ID tokens with a test RSA key and serves the matching
JWKS, so signature/issuer/audience/expiry/nonce validation is exercised for real.
No request leaves the process; no post is published.
"""
import base64
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr
from sqlalchemy import func, select, update

from app.core import token_crypto
from app.core.auth_config import JWT_SECRET
from app.core.security import create_access_token, hash_password
from app.core.social_config import SocialSettings, social_settings
from app.models.content import Post
from app.models.onboarding import WorkspaceMember
from app.models.schedule_events import ScheduleEvent
from app.models.scheduling import PostSchedule
from app.models.social_accounts import OAuthAuthorizationState, SocialAccount, SocialAccountCredential
from app.models.user import User
from app.services import linkedin_oauth
from test_content import draft
from test_onboarding import company, owner, workspace  # noqa: F401

ROOT = "/api/v1"
CALLBACK = f"{ROOT}/social-accounts/oauth/linkedin/callback"
REDIRECT_URI = "http://localhost:8000" + CALLBACK
CLIENT_ID = "test-linkedin-client"
CLIENT_SECRET = "test-linkedin-secret-value-never-exposed"
FRONTEND = "http://localhost:3000"


def new_key() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")


class FakeLinkedIn:
    def __init__(self):
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.private.public_key()))
        self.jwks = {"keys": [{**jwk, "kid": "test-kid", "use": "sig", "alg": "RS256"}]}
        self.sub = "member-" + uuid4().hex[:10]
        self.userinfo_sub = None
        self.scope = "email,openid,profile"
        self.refresh_token = None
        self.token_status = 200
        self.nonce = None
        self.claims_override: dict = {}
        self.sign_with = self.private
        self.include_id_token = True
        self.introspection = {"active": True, "status": "active", "scope": "openid,profile,email"}
        self.introspection_status = 200
        self.requests: list[httpx.Request] = []
        self.counter = 0

    def id_token(self):
        now = int(time.time())
        claims = {"iss": "https://www.linkedin.com/oauth", "aud": CLIENT_ID, "sub": self.sub, "iat": now, "exp": now + 3600}
        if self.nonce:
            claims["nonce"] = self.nonce
        claims.update(self.claims_override)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(claims, self.sign_with, algorithm="RS256", headers={"kid": "test-kid"})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url).split("?")[0]
        if url == linkedin_oauth.TOKEN_URL:
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_request", "error_description": "secret detail"})
            self.counter += 1
            body = {"access_token": f"AQX-access-{self.counter}-{uuid4().hex}", "expires_in": 5184000, "scope": self.scope}
            if self.include_id_token:
                body["id_token"] = self.id_token()
            if self.refresh_token:
                body |= {"refresh_token": self.refresh_token, "refresh_token_expires_in": 31536000}
            return httpx.Response(200, json=body)
        if url == linkedin_oauth.JWKS_URL:
            return httpx.Response(200, json=self.jwks)
        if url == linkedin_oauth.USERINFO_URL:
            return httpx.Response(200, json={"sub": self.userinfo_sub or self.sub, "name": "Asha Rao", "given_name": "Asha",
                                             "family_name": "Rao", "picture": "https://media.licdn.com/dms/image/asha.jpg",
                                             "email": "asha@example.com", "email_verified": True, "locale": {"country": "IN"}})
        if url == linkedin_oauth.INTROSPECT_URL:
            return httpx.Response(self.introspection_status, json=self.introspection)
        return httpx.Response(404)

    def form(self, kind="authorization_code"):
        found = [parse_qs(r.content.decode()) for r in self.requests if str(r.url) == linkedin_oauth.TOKEN_URL]
        return [f for f in found if f.get("grant_type") == [kind]]


@pytest.fixture
def fake(monkeypatch):
    provider = FakeLinkedIn()
    monkeypatch.setattr(linkedin_oauth, "transport", httpx.MockTransport(provider.handler))
    monkeypatch.setattr(linkedin_oauth, "_jwks_cache", {"keys": None, "fetched": 0.0})
    for name, value in {"LINKEDIN_CLIENT_ID": CLIENT_ID, "LINKEDIN_CLIENT_SECRET": SecretStr(CLIENT_SECRET),
                        "LINKEDIN_REDIRECT_URI": REDIRECT_URI, "LINKEDIN_SCOPES": "openid profile email",
                        "SOCIAL_TOKEN_ENCRYPTION_KEY": SecretStr(new_key()), "SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION": 1,
                        "SOCIAL_TOKEN_PREVIOUS_KEYS": SecretStr(""), "SOCIAL_OAUTH_STATE_MINUTES": 10}.items():
        monkeypatch.setattr(social_settings, name, value)
    return provider


@pytest.fixture
def org(client, owner):
    c = company(client, workspace(client)["id"])
    return c, f"{ROOT}/companies/{c['id']}/social-accounts"


def start(client, base, fake, path="/linkedin/connect"):
    response = client.post(base + path)
    assert response.status_code == 200, response.text
    query = parse_qs(urlsplit(response.json()["authorization_url"]).query)
    fake.nonce = query["nonce"][0]
    return query["state"][0], query, response


def callback(client, state, **params):
    params = {"state": state, "code": "auth-code-" + uuid4().hex} | params
    return client.get(CALLBACK, params={k: v for k, v in params.items() if v is not None}, follow_redirects=False)


def outcome(response):
    assert response.status_code == 303
    location = response.headers["location"]
    assert location.startswith(FRONTEND + "/dashboard/accounts?")
    return parse_qs(urlsplit(location).query)


def connect(client, base, fake):
    state, _, _ = start(client, base, fake)
    result = outcome(callback(client, state))
    assert result["social"] == ["connected"], result
    return result["account"][0]


def login_as(client, db, user=None):
    user = user or User(full_name="Other", email=f"other-{uuid4().hex}@example.com", hashed_password=hash_password("TestPassword123!"))
    db.add(user); db.commit()
    client.cookies.set("access_token", create_access_token(user.id))
    return user


# ---------------------------------------------------------------- configuration

def test_unconfigured_server_reports_variable_names_and_blocks_connect(client, org, monkeypatch):
    for name in ("LINKEDIN_CLIENT_ID", "LINKEDIN_REDIRECT_URI"):
        monkeypatch.setattr(social_settings, name, "")
    monkeypatch.setattr(social_settings, "LINKEDIN_CLIENT_SECRET", SecretStr(""))
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_ENCRYPTION_KEY", SecretStr(""))
    _, base = org
    catalog = client.get(base + "/platforms").json()
    linked = next(p for p in catalog["items"] if p["slug"] == "linkedin")
    assert linked["integration"] == "configuration_required" and catalog["publishing_enabled"] is False
    assert "LINKEDIN_CLIENT_ID is not set" in linked["configuration_issues"]
    assert "SOCIAL_TOKEN_ENCRYPTION_KEY is not set" in linked["configuration_issues"]
    assert {p["platform"]: p["integration"] for p in catalog["items"] if p["slug"] != "linkedin"} == {
        "Instagram": "coming_later", "Facebook": "coming_later", "X": "coming_later"}
    assert client.post(base + "/linkedin/connect").status_code == 503
    assert client.post(base + "/instagram/connect").status_code == 409
    assert client.post(base + "/myspace/connect").status_code == 404


def test_configuration_validation_rules():
    s = SocialSettings(LINKEDIN_CLIENT_ID="a", LINKEDIN_CLIENT_SECRET="b", LINKEDIN_REDIRECT_URI=REDIRECT_URI,
                       SOCIAL_TOKEN_ENCRYPTION_KEY=new_key())
    assert s.linkedin_issues() == []
    assert SocialSettings(**{**s.model_dump(), "SOCIAL_TOKEN_ENCRYPTION_KEY": JWT_SECRET}).encryption_issues()
    assert SocialSettings(SOCIAL_TOKEN_ENCRYPTION_KEY="too-short").encryption_issues()
    for uri in ("http://evil.example/api/v1/social-accounts/oauth/linkedin/callback", REDIRECT_URI + "?x=1",
                "https://localhost:8000/other", "relative/path"):
        assert SocialSettings(**{**s.model_dump(), "LINKEDIN_REDIRECT_URI": uri}).linkedin_issues()
    assert SocialSettings(**{**s.model_dump(), "LINKEDIN_SCOPES": "openid profile r_basicprofile"}).linkedin_issues()
    assert SocialSettings(**{**s.model_dump(), "LINKEDIN_SCOPES": "email"}).linkedin_issues()
    assert "secret" not in repr(SocialSettings(LINKEDIN_CLIENT_SECRET="secret"))


# ---------------------------------------------------------------- start

def test_start_builds_official_authorization_url_and_stores_only_hashes(client, db, org, fake):
    c, base = org
    state, query, response = start(client, base, fake)
    url = response.json()["authorization_url"]
    assert url.startswith(linkedin_oauth.AUTHORIZE_URL + "?") and "scope=openid%20profile%20email" in url
    assert query["response_type"] == ["code"] and query["client_id"] == [CLIENT_ID] and query["redirect_uri"] == [REDIRECT_URI]
    assert len(state) >= 43 and CLIENT_SECRET not in response.text
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Path=/api/v1/social-accounts/oauth" in cookie and "samesite=lax" in cookie.lower()
    record = db.scalar(select(OAuthAuthorizationState).where(OAuthAuthorizationState.company_id == UUID(c["id"])))
    assert record.state_hash == linkedin_oauth.digest(state) and state not in json.dumps(
        {k: str(v) for k, v in vars(record).items() if not k.startswith("_")})
    assert record.consumed_at is None and timedelta(minutes=9) < record.expires_at - record.created_at <= timedelta(minutes=10)
    assert record.user_id and record.purpose == "connect" and record.return_origin == FRONTEND


def test_start_requires_application_origin(client, org, fake):
    _, base = org
    assert client.post(base + "/linkedin/connect", headers={"Origin": "http://localhost:8000"}).status_code == 403
    assert client.post(base + "/linkedin/connect", headers={"Origin": "https://evil.example"}).status_code == 403


# ---------------------------------------------------------------- callback success

def test_callback_connects_verified_identity_with_encrypted_credential(client, db, org, fake):
    c, base = org
    state, _, _ = start(client, base, fake)
    response = callback(client, state, code="the-real-code")
    assert response.headers["referrer-policy"] == "no-referrer" and response.headers["cache-control"] == "no-store"
    assert "Max-Age=0" in response.headers["set-cookie"] or 'expires=' in response.headers["set-cookie"].lower()
    result = outcome(response)
    assert result["social"] == ["connected"] and result["company"] == [c["id"]]
    exchange = fake.form()[0]
    assert exchange["code"] == ["the-real-code"] and exchange["redirect_uri"] == [REDIRECT_URI]
    assert exchange["client_secret"] == [CLIENT_SECRET] and exchange["client_id"] == [CLIENT_ID]
    assert CLIENT_SECRET not in response.headers["location"] and "code" not in parse_qs(urlsplit(response.headers["location"]).query)
    listing = client.get(base)
    data = listing.json()
    account = data["items"][0]
    assert data["connected_count"] == 1 and data["publishing_enabled"] is False
    assert account["display_name"] == "Asha Rao" and account["email"] == "asha@example.com" and account["status"] == "limited"
    assert account["capabilities"] == ["verified_identity", "profile", "email"] and account["publishing_permission"] is False
    assert account["refresh_available"] is False and account["last_verified_at"] and account["token_expires_at"]
    for forbidden in ("AQX-access", "provider_account_id", fake.sub, "ciphertext", "key_version", CLIENT_SECRET):
        assert forbidden not in listing.text
        assert forbidden not in client.get(f"{base}/{account['id']}").text
    credential = db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account["id"])))
    assert b"AQX-access" not in credential.access_token_ciphertext and credential.refresh_token_ciphertext is None
    plain = token_crypto.decrypt(credential.access_token_ciphertext, credential.key_version, credential.social_account_id, "access_token")
    assert plain.startswith("AQX-access-1-") and credential.granted_scopes == ["email", "openid", "profile"]
    assert db.scalar(select(SocialAccount.provider_account_id).where(SocialAccount.id == UUID(account["id"]))) == fake.sub


def test_publishing_scope_is_recorded_only_when_granted(client, org, fake, monkeypatch):
    _, base = org
    monkeypatch.setattr(social_settings, "LINKEDIN_SCOPES", "openid profile email w_member_social")
    fake.scope = "email,openid,profile"  # requested but NOT granted by LinkedIn
    connect(client, base, fake)
    assert client.get(base).json()["items"][0]["status"] == "limited"
    fake.scope = "email,openid,profile,w_member_social"
    state, _, _ = start(client, base, fake)
    assert outcome(callback(client, state))["social"] == ["connected"]
    account = client.get(base).json()["items"][0]
    assert account["status"] == "connected" and account["publishing_permission"] is True
    assert "publish_member_posts" in account["capabilities"] and len(client.get(base).json()["items"]) == 1


# ---------------------------------------------------------------- state and session failures

def test_replayed_missing_unknown_and_expired_state(client, db, org, fake):
    c, base = org
    state, _, _ = start(client, base, fake)
    assert outcome(callback(client, state))["social"] == ["connected"]
    assert outcome(callback(client, state))["social"] == ["state_reused"]
    assert len(fake.form()) == 1  # a replay never reaches the token endpoint
    assert outcome(callback(client, None))["social"] == ["invalid_state"]
    assert outcome(callback(client, "forged-" + secrets.token_urlsafe(32)))["social"] == ["invalid_state"]
    assert outcome(callback(client, "x" * 5000))["social"] == ["invalid_state"]
    state, _, _ = start(client, base, fake)
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    db.execute(update(OAuthAuthorizationState).where(OAuthAuthorizationState.state_hash == linkedin_oauth.digest(state))
               .values(created_at=past - timedelta(minutes=10), expires_at=past)); db.commit()
    assert outcome(callback(client, state))["social"] == ["state_expired"]
    assert len(fake.form()) == 1


def test_oversized_code_is_not_echoed(client, org, fake):
    _, base = org
    state, _, _ = start(client, base, fake)
    response = callback(client, state, code="C" * 3000)
    assert outcome(response)["social"] == ["invalid_state"] and "CCCC" not in response.text + response.headers["location"]


def test_user_cancellation_and_denial_skip_token_exchange(client, org, fake):
    _, base = org
    for error, expected in (("user_cancelled_authorize", "cancelled"), ("user_cancelled_login", "cancelled"), ("access_denied", "denied")):
        state, _, _ = start(client, base, fake)
        response = callback(client, state, code=None, error=error, error_description="<script>secret detail</script>")
        assert outcome(response)["social"] == [expected] and "secret detail" not in response.headers["location"]
    assert fake.form() == [] and client.get(base).json()["items"] == []


def test_callback_requires_same_browser_and_same_user(client, db, org, fake):
    _, base = org
    owner_cookie = client.cookies.get("access_token")
    state, _, _ = start(client, base, fake)
    # Login-CSRF: the state is replayed in a browser without the binding cookie.
    for name in [n for n in client.cookies.keys() if n.startswith("socialai_oauth_")]:
        client.cookies.delete(name)
    assert outcome(callback(client, state))["social"] == ["session_mismatch"]
    state, _, _ = start(client, base, fake)
    login_as(client, db)  # binding cookie present, but another SocialAI user
    assert outcome(callback(client, state))["social"] == ["session_mismatch"]
    client.cookies.set("access_token", owner_cookie)
    state, _, _ = start(client, base, fake)
    client.cookies.delete("access_token")  # SocialAI session expired during consent
    assert outcome(callback(client, state))["social"] == ["session_expired"]
    assert fake.form() == []


def test_membership_revoked_during_consent_is_rejected(client, db, org, owner, fake):
    c, base = org
    state, _, _ = start(client, base, fake)
    db.execute(update(WorkspaceMember).where(WorkspaceMember.workspace_id == UUID(c["workspace_id"]), WorkspaceMember.user_id == owner.id)
               .values(role="member")); db.commit()
    assert outcome(callback(client, state))["social"] == ["not_authorized"]
    assert db.scalar(select(func.count()).select_from(SocialAccount).where(SocialAccount.company_id == UUID(c["id"]))) == 0


# ---------------------------------------------------------------- provider and identity failures

@pytest.mark.parametrize("status", [400, 401, 500])
def test_token_exchange_errors(client, db, org, fake, status):
    c, base = org
    fake.token_status = status
    state, _, _ = start(client, base, fake)
    response = callback(client, state)
    assert outcome(response)["social"] == ["provider_error"] and "secret detail" not in response.headers["location"]
    assert db.scalar(select(func.count()).select_from(SocialAccount).where(SocialAccount.company_id == UUID(c["id"]))) == 0


def test_provider_network_failure(client, org, fake, monkeypatch):
    _, base = org
    def broken(request):
        raise httpx.ConnectError("boom")
    monkeypatch.setattr(linkedin_oauth, "transport", httpx.MockTransport(broken))
    state, _, _ = start(client, base, fake)
    assert outcome(callback(client, state))["social"] == ["provider_error"]


@pytest.mark.parametrize("tamper", ["audience", "issuer", "expired", "signature", "nonce", "missing", "userinfo", "algorithm"])
def test_id_token_validation(client, db, org, fake, tamper):
    c, base = org
    state, _, _ = start(client, base, fake)
    if tamper == "audience":
        fake.claims_override = {"aud": "someone-else"}
    elif tamper == "issuer":
        fake.claims_override = {"iss": "https://evil.example"}
    elif tamper == "expired":
        fake.claims_override = {"exp": int(time.time()) - 600, "iat": int(time.time()) - 4000}
    elif tamper == "signature":
        fake.sign_with = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    elif tamper == "nonce":
        fake.nonce = "a-different-nonce"
    elif tamper == "missing":
        fake.include_id_token = False
    elif tamper == "userinfo":
        fake.userinfo_sub = "a-different-member"
    elif tamper == "algorithm":
        fake.claims_override = {}
        fake.id_token = lambda: jwt.encode({"iss": "https://www.linkedin.com/oauth", "aud": CLIENT_ID, "sub": fake.sub,
                                            "iat": int(time.time()), "exp": int(time.time()) + 600}, "x" * 32, algorithm="HS256")
    assert outcome(callback(client, state))["social"] == ["identity_unverified"]
    assert db.scalar(select(func.count()).select_from(SocialAccount).where(SocialAccount.company_id == UUID(c["id"]))) == 0


def test_documented_alternate_issuer_is_accepted(client, org, fake):
    _, base = org
    fake.claims_override = {"iss": "https://www.linkedin.com"}
    connect(client, base, fake)


# ---------------------------------------------------------------- reconnect, duplicates, tenants

def test_reconnect_replaces_credential_and_rejects_wrong_account(client, db, org, fake):
    c, base = org
    account_id = connect(client, base, fake)
    old = db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account_id)))
    old_blob = bytes(old.access_token_ciphertext)
    response = client.post(f"{base}/{account_id}/reconnect")
    query = parse_qs(urlsplit(response.json()["authorization_url"]).query); fake.nonce = query["nonce"][0]
    result = outcome(callback(client, query["state"][0]))
    assert result["social"] == ["reconnected"] and result["account"] == [account_id]
    db.expire_all()
    credentials = db.scalars(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account_id))).all()
    assert len(credentials) == 1 and bytes(credentials[0].access_token_ciphertext) != old_blob
    # Reconnect, but the person signs in to LinkedIn as somebody else.
    query = parse_qs(urlsplit(client.post(f"{base}/{account_id}/reconnect").json()["authorization_url"]).query); fake.nonce = query["nonce"][0]
    fake.sub = "member-someone-else"
    assert outcome(callback(client, query["state"][0]))["social"] == ["wrong_account"]
    assert [a["id"] for a in client.get(base).json()["items"]] == [account_id]


def test_duplicate_connect_upserts_and_companies_never_share_credentials(client, db, owner, fake):
    w = workspace(client)
    first, second = company(client, w["id"]), company(client, w["id"], name="Second Cafe")
    a = connect(client, f"{ROOT}/companies/{first['id']}/social-accounts", fake)
    again = connect(client, f"{ROOT}/companies/{first['id']}/social-accounts", fake)
    b = connect(client, f"{ROOT}/companies/{second['id']}/social-accounts", fake)
    assert a == again and a != b
    rows = db.scalars(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id.in_([UUID(a), UUID(b)]))).all()
    assert len(rows) == 2 and rows[0].company_id != rows[1].company_id
    tokens = {token_crypto.decrypt(r.access_token_ciphertext, r.key_version, r.social_account_id, "access_token") for r in rows}
    assert len(tokens) == 2
    # The second company's path cannot read the first company's account.
    assert client.get(f"{ROOT}/companies/{second['id']}/social-accounts/{a}").status_code == 404
    assert client.post(f"{ROOT}/companies/{second['id']}/social-accounts/{a}/disconnect").status_code == 404


def test_cross_tenant_and_role_permissions(client, db, org, fake):
    c, base = org
    account_id = connect(client, base, fake)
    owner_cookie = client.cookies.get("access_token")
    outsider = login_as(client, db)
    for method, path in (("get", base), ("get", f"{base}/{account_id}"), ("get", f"{base}/{account_id}/status"),
                         ("get", base + "/platforms"), ("post", base + "/linkedin/connect"), ("post", f"{base}/{account_id}/disconnect"),
                         ("post", f"{base}/{account_id}/reconnect"), ("post", f"{base}/{account_id}/verify")):
        assert getattr(client, method)(path).status_code == 404, path
    db.add(WorkspaceMember(workspace_id=UUID(c["workspace_id"]), user_id=outsider.id, role="member")); db.commit()
    assert client.get(base).json()["items"][0]["id"] == account_id
    assert client.get(f"{base}/{account_id}/status").status_code == 200
    for path in ("/linkedin/connect", f"/{account_id}/disconnect", f"/{account_id}/reconnect", f"/{account_id}/verify"):
        assert client.post(base + path).status_code == 403, path
    db.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == outsider.id).values(role="admin")); db.commit()
    assert client.post(base + "/linkedin/connect").status_code == 200
    client.cookies.clear()
    assert client.get(base).status_code == 401
    client.cookies.set("access_token", owner_cookie)
    assert client.post(base + "/linkedin/connect", headers={"Origin": "https://evil.example"}).status_code == 403


def test_tampered_credential_cannot_move_between_accounts(client, db, owner, fake):
    w = workspace(client)
    first, second = company(client, w["id"]), company(client, w["id"], name="Second Cafe")
    a = connect(client, f"{ROOT}/companies/{first['id']}/social-accounts", fake)
    fake.sub = "member-other"
    b = connect(client, f"{ROOT}/companies/{second['id']}/social-accounts", fake)
    ra, rb = (db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(x))) for x in (a, b))
    with pytest.raises(token_crypto.CredentialCryptoError):  # AAD binds ciphertext to its own account
        token_crypto.decrypt(ra.access_token_ciphertext, ra.key_version, rb.social_account_id, "access_token")
    # The composite FK forbids a credential whose company differs from its account's company.
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        db.execute(update(SocialAccountCredential).where(SocialAccountCredential.id == ra.id).values(company_id=UUID(second["id"])))
        db.flush()
    db.rollback()


# ---------------------------------------------------------------- lifecycle

def test_disconnect_deletes_credential_and_reconnect_revives(client, db, org, fake):
    c, base = org
    account_id = connect(client, base, fake)
    response = client.post(f"{base}/{account_id}/disconnect")
    body = response.json()
    assert response.status_code == 200 and body["account"]["status"] == "disconnected" and body["provider_access_revoked"] is False
    assert "Permitted services" in body["guidance"]
    assert db.scalar(select(func.count()).select_from(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account_id))) == 0
    assert client.get(base).json()["items"] == []
    assert client.get(base + "?include_disconnected=true").json()["items"][0]["status"] == "disconnected"
    assert client.post(f"{base}/{account_id}/disconnect").json()["account"]["status"] == "disconnected"  # idempotent
    assert client.post(f"{base}/{account_id}/verify").status_code == 409
    assert connect(client, base, fake) == account_id
    revived = client.get(f"{base}/{account_id}").json()
    assert revived["status"] == "limited" and revived["disconnected_at"] is None


def test_expired_token_without_refresh_requires_reconnect(client, db, org, fake):
    _, base = org
    account_id = connect(client, base, fake)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(update(SocialAccount).where(SocialAccount.id == UUID(account_id)).values(token_expires_at=past)); db.commit()
    status = client.get(f"{base}/{account_id}/status").json()
    assert status["status"] == "reconnect_required" and status["refresh_available"] is False and status["provider_checked"] is False
    assert client.get(base).json()["connected_count"] == 0
    assert not [r for r in fake.requests if str(r.url) == linkedin_oauth.INTROSPECT_URL]  # status reads never call LinkedIn


def test_refresh_token_stored_only_when_supplied_and_used_on_expiry(client, db, org, fake):
    _, base = org
    fake.refresh_token = "AQR-refresh-" + uuid4().hex
    account_id = connect(client, base, fake)
    credential = db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account_id)))
    assert credential.refresh_token_ciphertext is not None and credential.refresh_token_expires_at is not None
    assert fake.refresh_token.encode() not in credential.refresh_token_ciphertext
    assert client.get(f"{base}/{account_id}").json()["refresh_available"] is True
    fake.introspection = {"active": False, "status": "expired"}
    result = client.post(f"{base}/{account_id}/verify")
    assert result.status_code == 200 and result.json()["status"] == "limited" and result.json()["provider_checked"] is True
    refresh_form = fake.form("refresh_token")[0]
    assert refresh_form["refresh_token"] == [fake.refresh_token] and refresh_form["client_secret"] == [CLIENT_SECRET]
    db.expire_all()
    credential = db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account_id)))
    assert token_crypto.decrypt(credential.access_token_ciphertext, credential.key_version, credential.social_account_id, "access_token").startswith("AQX-access-2-")
    assert token_crypto.decrypt(credential.refresh_token_ciphertext, credential.key_version, credential.social_account_id, "refresh_token") == fake.refresh_token


def test_verify_maps_confirmed_provider_states_and_keeps_state_on_outage(client, db, org, fake):
    _, base = org
    account_id = connect(client, base, fake)
    before = client.get(f"{base}/{account_id}").json()
    fake.introspection = {"active": True, "status": "active", "scope": "openid,profile,email", "expires_at": int(time.time()) + 86400}
    verified = client.post(f"{base}/{account_id}/verify").json()
    assert verified["status"] == "limited" and verified["last_verified_at"] >= before["last_verified_at"]
    fake.introspection_status = 500
    assert client.post(f"{base}/{account_id}/verify").status_code == 502
    assert client.get(f"{base}/{account_id}").json()["status"] == "limited"
    fake.introspection_status = 401  # our client secret was rejected: not the member's fault
    assert client.post(f"{base}/{account_id}/verify").status_code == 502
    fake.introspection_status, fake.introspection = 200, {"active": False, "status": "revoked"}
    revoked = client.post(f"{base}/{account_id}/verify").json()
    assert revoked["status"] == "reconnect_required" and revoked["last_error_code"] == "token_revoked"
    assert client.get(base).json()["items"][0]["status"] == "reconnect_required"


# ---------------------------------------------------------------- encryption

def test_encryption_roundtrip_versions_and_rotation(db, monkeypatch, fake):
    account = uuid4()
    version, blob = token_crypto.encrypt("token-value", account, "access_token")
    assert version == 1 and b"token-value" not in blob
    assert token_crypto.encrypt("token-value", account, "access_token")[1] != blob  # fresh nonce each time
    assert token_crypto.decrypt(blob, 1, account, "access_token") == "token-value"
    with pytest.raises(token_crypto.CredentialCryptoError):
        token_crypto.decrypt(blob, 1, account, "refresh_token")
    tampered = bytearray(blob); tampered[-1] ^= 1
    with pytest.raises(token_crypto.CredentialCryptoError):
        token_crypto.decrypt(bytes(tampered), 1, account, "access_token")
    old_key = social_settings.SOCIAL_TOKEN_ENCRYPTION_KEY.get_secret_value()
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_ENCRYPTION_KEY", SecretStr(new_key()))
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION", 2)
    with pytest.raises(token_crypto.CredentialCryptoError):  # old version unavailable until listed
        token_crypto.decrypt(blob, 1, account, "access_token")
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_PREVIOUS_KEYS", SecretStr(f"1:{old_key}"))
    assert token_crypto.decrypt(blob, 1, account, "access_token") == "token-value"
    assert token_crypto.encrypt("x", account, "access_token")[0] == 2
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_ENCRYPTION_KEY", SecretStr(JWT_SECRET))
    with pytest.raises(token_crypto.CredentialCryptoError):
        token_crypto.encrypt("x", account, "access_token")


def test_rotation_script_reencrypts_old_rows(client, db, org, fake, monkeypatch):
    import importlib.util, pathlib
    spec = importlib.util.spec_from_file_location("rotate", pathlib.Path(__file__).parents[1] / "scripts" / "rotate_social_token_key.py")
    rotate = importlib.util.module_from_spec(spec); spec.loader.exec_module(rotate)
    _, base = org
    fake.refresh_token = "AQR-" + uuid4().hex
    account_id = connect(client, base, fake)
    old_key = social_settings.SOCIAL_TOKEN_ENCRYPTION_KEY.get_secret_value()
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_ENCRYPTION_KEY", SecretStr(new_key()))
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION", 2)
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_PREVIOUS_KEYS", SecretStr(f"1:{old_key}"))
    dry = rotate.rotate(db, apply=False)
    assert dry["would_reencrypt"] >= 1 and dry["remaining_on_old_versions"] >= 1
    applied = rotate.rotate(db, apply=True)
    assert applied["remaining_on_old_versions"] == 0 and applied["undecryptable"] == 0
    row = db.scalar(select(SocialAccountCredential).where(SocialAccountCredential.social_account_id == UUID(account_id)))
    assert row.key_version == 2
    monkeypatch.setattr(social_settings, "SOCIAL_TOKEN_PREVIOUS_KEYS", SecretStr(""))  # old key retired
    assert token_crypto.decrypt(row.refresh_token_ciphertext, 2, row.social_account_id, "refresh_token") == fake.refresh_token


def test_token_set_repr_hides_secrets():
    tokens = linkedin_oauth.TokenSet("secret-access", 10, ("openid",), "secret-refresh", 20, "id")
    assert "secret" not in repr(tokens) and "secret" not in str(tokens)


# ---------------------------------------------------------------- CRM integration and no publishing

def test_connections_never_touch_posts_or_schedules_and_feed_crm_counts(client, db, org, fake):
    c, base = org
    root = f"{ROOT}/companies/{c['id']}"
    client.post(root + "/brand/confirm", json={"revision": 1})
    post = client.post(root + "/posts", json=draft(creation_key=str(uuid4()), platform="LinkedIn")).json()
    post = client.post(f"{root}/posts/{post['id']}/approve", json={"revision": post["revision"]}).json()
    day = (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat()
    schedule = client.post(root + "/schedules", json=dict(post_id=post["id"], target_platform="LinkedIn", post_revision=post["revision"],
                                                          local_date=day, local_time="10:00", timezone="Asia/Kolkata", idempotency_key=str(uuid4())))
    assert schedule.status_code == 201, schedule.text
    snapshot = lambda: (db.scalar(select(func.count()).select_from(Post)), db.scalar(select(func.count()).select_from(PostSchedule)),
                        db.scalar(select(func.count()).select_from(ScheduleEvent)),
                        db.execute(select(PostSchedule.status, PostSchedule.revision, PostSchedule.social_account_id)
                                   .where(PostSchedule.id == UUID(schedule.json()["id"]))).one())
    before = snapshot()
    summary = client.get(root + "/dashboard/summary").json()
    assert summary["social_account_stats"]["total"] == 0 and summary["publishing_available"] is False
    account_id = connect(client, base, fake)
    summary = client.get(root + "/dashboard/summary").json()
    assert summary["social_account_stats"] == {"total": 1, "connected": 0, "limited": 1, "reconnect_required": 0, "error": 0,
                                               "connected_platforms": ["LinkedIn"], "publishing_permission": 0}
    assert summary["publishing_available"] is False
    client.post(f"{base}/{account_id}/disconnect")
    db.expire_all()
    assert snapshot() == before and before[3][2] is None and before[3][0] == "scheduled"
    assert not [r for r in fake.requests if "api.linkedin.com/rest" in str(r.url) or "ugcPosts" in str(r.url)]
