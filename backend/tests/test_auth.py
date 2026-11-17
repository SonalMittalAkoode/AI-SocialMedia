from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.auth_config import JWT_SECRET, JWT_ALGORITHM
from app.core.security import verify_password
from app.models.user import User

AUTH = "/api/v1/auth"


def register(client, credentials):
    response = client.post(f"{AUTH}/register", json=credentials)
    assert response.status_code == 201, response.json()
    return response.json()


def test_register_hash_and_safe_response(client, db, credentials):
    response = register(client, credentials)
    assert set(response) == {"id", "full_name", "email", "is_active", "is_verified", "created_at"}
    assert response["is_active"] is True
    assert response["is_verified"] is False
    stored = db.scalar(select(User).where(User.email == credentials["email"]))
    assert stored.hashed_password.startswith("$argon2id$")
    assert stored.hashed_password != credentials["password"]
    assert verify_password(credentials["password"], stored.hashed_password)
    assert client.get(f"{AUTH}/me").status_code == 401  # Registration does not sign in.


def test_email_normalization_and_duplicate(client, credentials):
    register(client, {**credentials, "email": f"  {credentials['email'].upper()}  ", "full_name": "  Auth Test User  "})
    duplicate = client.post(f"{AUTH}/register", json=credentials)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Email already registered"


@pytest.mark.parametrize("changes", [{"email": "invalid"}, {"password": "short"}, {"password": "abcdefghijklmnop"}, {"password": "123456789012"}, {"password": "a" * 129}, {"full_name": "  "}])
def test_registration_validation(client, credentials, changes):
    response=client.post(f"{AUTH}/register", json={**credentials, **changes})
    assert response.status_code == 422
    assert all('input' not in error for error in response.json()['detail'])


def test_login_cookie_and_current_user(client, credentials):
    user = register(client, credentials)
    response = client.post(f"{AUTH}/login", json={"email": credentials["email"].upper(), "password": credentials["password"]})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "max-age=1800" in cookie and "path=/" in cookie
    assert "secure" not in cookie  # Local HTTP development default.
    assert response.headers["cache-control"] == "no-store"
    me = client.get(f"{AUTH}/me")
    assert me.status_code == 200 and me.json()["id"] == user["id"]
    assert "password" not in me.text and "access_token" not in me.text


def test_remember_false_uses_session_cookie(client, credentials):
    register(client, credentials)
    response = client.post(f"{AUTH}/login", json={**credentials, "remember_me": False})
    assert response.status_code == 200
    assert "max-age" not in response.headers["set-cookie"].lower()


def test_bad_password_and_unknown_email_are_generic(client, credentials):
    register(client, credentials)
    bad = client.post(f"{AUTH}/login", json={**credentials, "password": "WrongPassword123!"})
    unknown = client.post(f"{AUTH}/login", json={**credentials, "email": "unknown-auth-test@example.com"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json() == {"detail": "Invalid email or password"}


def test_missing_cookie(client):
    assert client.get(f"{AUTH}/me").status_code == 401


@pytest.mark.parametrize("changes", [
    {"exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
    {"type": "refresh"}, {"sub": "not-a-uuid"}, {"sub": []},
    {"sub": str(uuid4())}, {"exp": None}, {"iat": None},
])
def test_invalid_claims_rejected(client, changes):
    payload = {"sub": str(uuid4()), "exp": datetime.now(timezone.utc) + timedelta(minutes=30), "iat": datetime.now(timezone.utc), "type": "access"}
    payload.update(changes)
    payload = {key: value for key, value in payload.items() if value is not None}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    client.cookies.set("access_token", token)
    assert client.get(f"{AUTH}/me").status_code == 401


def test_tampered_signature(client):
    token = jwt.encode({"sub": str(uuid4()), "exp": datetime.now(timezone.utc) + timedelta(minutes=30), "iat": datetime.now(timezone.utc), "type": "access"}, "test-only-different-signing-key-32chars", algorithm=JWT_ALGORITHM)
    client.cookies.set("access_token", token)
    assert client.get(f"{AUTH}/me").status_code == 401


def test_disabled_user_login_and_me(client, credentials, db):
    register(client, credentials)
    assert client.post(f"{AUTH}/login", json=credentials).status_code == 200
    user = db.scalar(select(User).where(User.email == credentials["email"]))
    user.is_active = False
    db.commit()
    assert client.get(f"{AUTH}/me").status_code == 401
    assert client.post(f"{AUTH}/login", json=credentials).status_code == 403


def test_logout_clears_cookie(client, credentials):
    register(client, credentials)
    assert client.post(f"{AUTH}/login", json=credentials).status_code == 200
    response = client.post(f"{AUTH}/logout", json={})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "max-age=0" in cookie and "path=/" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert client.get(f"{AUTH}/me").status_code == 401


@pytest.mark.parametrize("path", ["register", "login", "logout"])
def test_origin_protection(client, credentials, path):
    assert client.post(f"{AUTH}/{path}", json=credentials, headers={"Origin": "https://untrusted.example"}).status_code == 403
    client.headers.pop("Origin")
    assert client.post(f"{AUTH}/{path}", json=credentials).status_code == 403


def test_swagger_same_origin_and_credentialed_cors(client):
    assert client.post(f"{AUTH}/logout", json={}, headers={"Origin": "http://localhost:8000"}).status_code == 200
    response = client.options(f"{AUTH}/login", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_concurrent_duplicate_commit_is_safe(client, db, credentials, monkeypatch):
    def conflict():
        raise IntegrityError("insert", {}, Exception("duplicate"))
    monkeypatch.setattr(db, "commit", conflict)
    response = client.post(f"{AUTH}/register", json=credentials)
    assert response.status_code == 409
    assert "insert" not in response.text


@pytest.mark.parametrize("path", ["register", "login"])
def test_database_failure_is_safe(client, db, credentials, monkeypatch, path):
    def unavailable(*args, **kwargs):
        raise OperationalError("sensitive database query", {}, Exception("connection unavailable"))
    monkeypatch.setattr(db, "scalar", unavailable)
    response = client.post(f"{AUTH}/{path}", json=credentials)
    assert response.status_code == 503
    assert "sensitive" not in response.text and "query" not in response.text
