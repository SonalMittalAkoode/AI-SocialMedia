from uuid import uuid4
import pytest
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError, OperationalError
from app.models.user import User
from app.models.onboarding import Workspace, WorkspaceMember, Company, BrandProfile, ContentPreferences, OnboardingProgress
from app.core.security import create_access_token, hash_password
from app.services import onboarding as service

ROOT = "/api/v1"


@pytest.fixture
def owner(client, db):
    user = User(full_name="Company Owner", email=f"owner-{uuid4().hex}@example.com", hashed_password=hash_password("TestPassword123!"))
    db.add(user)
    db.commit()
    client.cookies.set("access_token", create_access_token(user.id))
    return user


def workspace(client, name="Creative workspace", key=None):
    response = client.post(f"{ROOT}/workspaces", json={"name": name, "idempotency_key": str(key or uuid4())})
    assert response.status_code == 201, response.json()
    return response.json()


def company(client, workspace_id, **fields):
    response = client.post(f"{ROOT}/workspaces/{workspace_id}/companies", json={"name": "My Cafe", "description": "A thoughtful neighborhood coffee shop.", **fields})
    assert response.status_code == 201, response.json()
    return response.json()


def resource(client, company_id, name):
    response = client.get(f"{ROOT}/companies/{company_id}/{name}")
    assert response.status_code == 200, response.json()
    return response.json()


def complete_step(client, company_id, step, **fields):
    progress = resource(client, company_id, "onboarding")
    return client.post(f"{ROOT}/companies/{company_id}/onboarding/complete-step", json={"revision": progress["revision"], "step": step, **fields})


def test_workspace_atomic_owner_and_unique_slugs(client, db, owner):
    a = workspace(client)
    b = workspace(client)
    assert a["slug"] != b["slug"]
    member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == a["id"]))
    assert member.user_id == owner.id and member.role == "owner"
    assert client.get(f"{ROOT}/workspaces/{a['id']}/membership").json()["role"] == "owner"
    assert len(client.get(f"{ROOT}/workspaces").json()) == 2


def test_idempotent_creation_and_initialization(client, db, owner):
    key = uuid4()
    a = workspace(client, key=key)
    assert workspace(client, key=key)["id"] == a["id"]
    assert client.post(f"{ROOT}/workspaces", json={"name":"Changed payload", "idempotency_key":str(key)}).status_code == 409
    key = str(uuid4())
    c = company(client, a["id"], idempotency_key=key)
    assert company(client, a["id"], idempotency_key=key)["id"] == c["id"]
    assert client.post(f"{ROOT}/workspaces/{a['id']}/companies", json={"name": "Changed request", "idempotency_key": key}).status_code == 409
    assert db.scalar(select(func.count()).select_from(Company).where(Company.workspace_id == a["id"])) == 1
    assert resource(client, c["id"], "brand")["is_confirmed"] is False
    assert resource(client, c["id"], "preferences")["platforms"] == []
    assert resource(client, c["id"], "onboarding")["current_step"] == "business"
    assert c["website_url"] is None and c["country"] is None


def test_company_update_checks_related_brand_revision(client, owner):
    c=company(client, workspace(client)["id"])
    url=f"{ROOT}/companies/{c['id']}"
    assert client.patch(url+'/brand',json={"revision":1,"tagline":"Concurrent brand change"}).status_code == 200
    assert client.patch(url,json={"revision":1,"expected_brand_revision":1,"name":"Stale company editor"}).status_code == 409


def test_database_membership_and_foreign_key_constraints(client, db, owner):
    w = workspace(client)
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(WorkspaceMember(workspace_id=w["id"], user_id=owner.id, role="member"))
        db.flush()
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(Company(workspace_id=uuid4(), name="Invalid parent"))
        db.flush()


def test_initialization_failure_rolls_back_all_records(client, db, owner, monkeypatch):
    w = workspace(client)
    def fail():
        raise OperationalError("private statement", {}, Exception("unavailable"))
    monkeypatch.setattr(db, "commit", fail)
    response = client.post(f"{ROOT}/workspaces/{w['id']}/companies", json={"name": "Rollback company"})
    assert response.status_code == 503 and "private" not in response.text
    assert db.scalar(select(func.count()).select_from(Company).where(Company.workspace_id == w["id"])) == 0
    for model in [BrandProfile, ContentPreferences, OnboardingProgress]:
        assert db.scalar(select(func.count()).select_from(model).join(Company, model.company_id == Company.id).where(Company.workspace_id == w["id"])) == 0


def test_owner_membership_failure_rolls_back_workspace(client, db, owner, monkeypatch):
    original = db.add
    def add(record):
        if isinstance(record, WorkspaceMember):
            raise OperationalError("private", {}, Exception("unavailable"))
        return original(record)
    monkeypatch.setattr(db, "add", add)
    assert client.post(f"{ROOT}/workspaces", json={"name": "Rollback workspace"}).status_code == 503
    assert db.scalar(select(func.count()).select_from(Workspace).where(Workspace.created_by == owner.id)) == 0


def test_authentication_and_origin_required(client):
    assert client.post(f"{ROOT}/workspaces", json={"name": "No session"}).status_code == 401


def test_cross_tenant_reads_and_writes_concealed(client, db, owner):
    w = workspace(client)
    c = company(client, w["id"])
    other = User(full_name="Other Owner", email=f"other-{uuid4().hex}@example.com", hashed_password=owner.hashed_password)
    db.add(other)
    db.commit()
    client.cookies.set("access_token", create_access_token(other.id))
    assert client.get(f"{ROOT}/workspaces").json() == []
    assert client.get(f"{ROOT}/workspaces/{w['id']}").status_code == 404
    assert client.get(f"{ROOT}/workspaces/{w['id']}/companies").status_code == 404
    for suffix in ["", "/brand", "/preferences", "/onboarding"]:
        assert client.get(f"{ROOT}/companies/{c['id']}{suffix}").status_code == 404
    for method, suffix, payload in [
        ("patch", "", {"revision": 1, "name": "Intruder"}),
        ("patch", "/brand", {"revision": 1, "display_name": "Intruder"}),
        ("post", "/brand/confirm", {"revision": 1}),
        ("put", "/preferences", {"revision": 1, "platforms": ["x"]}),
        ("patch", "/onboarding", {"revision": 1, "current_step": "business"}),
        ("post", "/onboarding/complete-step", {"revision": 1, "step": "business"}),
        ("post", "/onboarding/complete", {"revision": 1}),
    ]:
        assert getattr(client, method)(f"{ROOT}/companies/{c['id']}{suffix}", json=payload).status_code == 404


def test_member_readonly_admin_writes(client, db, owner):
    w = workspace(client)
    c = company(client, w["id"])
    member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.user_id == owner.id))
    member.role = "member"
    db.commit()
    assert client.get(f"{ROOT}/companies/{c['id']}").status_code == 200
    assert client.patch(f"{ROOT}/companies/{c['id']}", json={"revision": 1, "name": "Forbidden"}).status_code == 403
    assert client.patch(f"{ROOT}/workspaces/{w['id']}", json={"revision": 1, "name": "Forbidden"}).status_code == 403
    member.role = "admin"
    db.commit()
    assert client.patch(f"{ROOT}/companies/{c['id']}", json={"revision": 1, "name": "Allowed"}).status_code == 200


@pytest.mark.parametrize("url", ["javascript:alert(1)", "ftp://example.com", "https://bad host.com", "https://user:pass@example.com", "https://-bad.example", "https://[invalid"])
def test_bad_company_urls(client, owner, url):
    w = workspace(client)
    assert client.post(f"{ROOT}/workspaces/{w['id']}/companies", json={"name": "Bad URL", "website_url": url}).status_code == 422


def test_url_normalization_optional_and_social(client, owner):
    w = workspace(client)
    c = company(client, w["id"], website_url="HTTPS://Example.COM/menu#fragment", source_social_url="https://instagram.com/mycafe")
    assert c["website_url"] == "https://example.com/menu"
    assert company(client, w["id"])["website_url"] is None
    assert client.patch(f"{ROOT}/companies/{c['id']}", json={"revision": 1, "workspace_id": str(uuid4())}).status_code == 422
    assert client.get(f"{ROOT}/companies/not-a-uuid").status_code == 422
    assert client.get(f"{ROOT}/companies/{uuid4()}").status_code == 404


def test_brand_partial_update_confirmation_and_reconfirmation(client, db, owner):
    c = company(client, workspace(client)["id"])
    url = f"{ROOT}/companies/{c['id']}/brand"
    brand = resource(client, c["id"], "brand")
    changed = client.patch(url, json={"revision": brand["revision"], "brand_colors": ["#abc", "#67442c"], "brand_voice": ["Friendly", "Warm"]}).json()
    confirmed = client.post(url + "/confirm", json={"revision": changed["revision"]})
    assert confirmed.status_code == 200 and confirmed.json()["confirmed_at"]
    updated = client.patch(url, json={"revision": confirmed.json()["revision"], "tagline": "A new direction"}).json()
    assert updated["brand_colors"] == ["#abc", "#67442c"] and updated["is_confirmed"] is False and updated["confirmed_at"] is None
    assert db.scalar(select(func.count()).select_from(BrandProfile).where(BrandProfile.company_id == c["id"])) == 1
    assert client.patch(url, json={"revision": updated["revision"], "brand_colors": ["red"]}).status_code == 422
    assert client.patch(url, json={"revision": updated["revision"], "social_links": {"instagram": "https://example.com"}}).status_code == 422
    assert client.patch(url, json={"revision": updated["revision"], "source": "ai"}).status_code == 422


def test_incomplete_confirmation_and_stale_revision(client, owner):
    c = company(client, workspace(client)["id"], description=None)
    url = f"{ROOT}/companies/{c['id']}/brand"
    assert client.post(url + "/confirm", json={"revision": 1}).status_code == 422
    assert client.patch(url, json={"revision": 1, "description": "Updated brand description."}).status_code == 200
    assert client.patch(url, json={"revision": 1, "description": "Stale overwrite."}).status_code == 409
    assert resource(client, c["id"], "brand")["description"] == "Updated brand description."


def test_preferences_typed_partial_and_frequency(client, owner):
    c = company(client, workspace(client)["id"])
    url = f"{ROOT}/companies/{c['id']}/preferences"
    p = client.put(url, json={"revision": 1, "platforms": ["instagram"], "content_goals": ["brand_awareness"], "tone": ["friendly"], "content_formats": ["image_post"]}).json()
    changed = client.put(url, json={"revision": p["revision"], "language": "hindi"}).json()
    assert changed["platforms"] == ["instagram"] and changed["language"] == "hindi"
    for payload in [{"platforms": ["tiktok"]}, {"language": "spanish"}, {"platforms": ["x", "x"]}, {"posting_frequency": "custom"}, {"excluded_topics": ["a" * 101]}]:
        assert client.put(url, json={"revision": changed["revision"], **payload}).status_code == 422


def test_valid_onboarding_demo_completion_and_invalidation(client, owner):
    c = company(client, workspace(client)["id"])
    url = f"{ROOT}/companies/{c['id']}"
    assert client.patch(url + "/onboarding", json={"revision": 1, "current_step": "generate"}).status_code == 422
    assert client.post(url + "/onboarding/complete", json={"revision": 1}).status_code == 422
    assert complete_step(client, c["id"], "brand").status_code == 422
    assert complete_step(client, c["id"], "business").status_code == 200
    assert client.post(url + "/brand/confirm", json={"revision": 1}).status_code == 200
    assert complete_step(client, c["id"], "brand").status_code == 200
    assert complete_step(client, c["id"], "competitors").status_code == 200
    assert complete_step(client, c["id"], "competitors", demo_acknowledged=True).status_code == 200
    assert complete_step(client, c["id"], "preferences").status_code == 422
    assert client.put(url + "/preferences", json={"revision": 1, "platforms": ["instagram"], "content_goals": ["brand_awareness"], "tone": ["friendly"], "content_formats": ["image_post"]}).status_code == 200
    assert complete_step(client, c["id"], "preferences").status_code == 200
    assert complete_step(client, c["id"], "generate", demo_acknowledged=True).status_code == 200
    progress = resource(client, c["id"], "onboarding")
    assert client.post(url + "/onboarding/complete", json={"revision": progress["revision"]}).json()["demo_completed"] is True
    b = resource(client, c["id"], "brand")
    assert client.patch(url + "/brand", json={"revision": b["revision"], "tagline": "Material edit"}).status_code == 200
    progress = resource(client, c["id"], "onboarding")
    assert progress["current_step"] == "brand" and progress["completed_steps"] == ["business"] and progress["status"] == "in_progress"
    assert client.patch(url + "/onboarding", json={"revision": progress["revision"], "current_step": "business"}).status_code == 200
    assert client.patch(url + "/onboarding", json={"revision": progress["revision"], "current_step": "brand"}).status_code == 409


def test_invalid_onboarding_and_protected_fields(client, owner):
    c = company(client, workspace(client)["id"])
    url = f"{ROOT}/companies/{c['id']}/onboarding"
    assert client.patch(url, json={"revision": 1, "current_step": "fake"}).status_code == 422
    assert client.patch(url, json={"revision": 1, "current_step": "business", "completed_steps": service.STEPS}).status_code == 422
    assert client.post(f"{ROOT}/workspaces", json={"name": "No ownership forgery", "created_by": str(uuid4())}).status_code == 422
    assert client.post(f"{ROOT}/workspaces", json={"name": "No CSRF"}, headers={"Origin": "https://attacker.example"}).status_code == 403
