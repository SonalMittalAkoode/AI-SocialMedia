from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.core.security import create_access_token
from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult
from app.models.intelligence import AIJob
from app.models.user import User
from app.services import ai_provider
from test_onboarding import company, complete_step, owner, resource, workspace


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai")
    monkeypatch.setattr(ai_provider, "text_configured", lambda: True)
    monkeypatch.setattr(ai_provider, "image_configured", lambda: True)


def get_root(company_id):
    return f"/api/v1/companies/{company_id}"


def confirm(client, company_id):
    brand = resource(client, company_id, "brand")
    assert client.post(get_root(company_id) + "/brand/confirm", json={"revision": brand["revision"]}).status_code == 200
    assert complete_step(client, company_id, "business").is_success
    assert complete_step(client, company_id, "brand").is_success


def goals(client, company_id, **changes):
    return {
        "revision": resource(client, company_id, "onboarding")["revision"],
        "preferences_revision": resource(client, company_id, "preferences")["revision"],
        "goal": "lead_generation", "platforms": ["linkedin", "instagram"], "voice": "bold",
        **changes,
    }


def test_website_review_fills_verified_blanks_and_preserves_manual_facts(client, db, owner):
    url = "https://sample-bakery.org/"
    c = company(client, workspace(client)["id"], name="sample-bakery.org", city="Pune",
                description=None, website_url=url)
    root = get_root(c["id"])
    job = BrandExtractionJob(company_id=c["id"], requested_by=owner.id, requested_url=url)
    db.add(job)
    db.flush()
    data = {"job_id": str(job.id)}
    assert client.post(root + "/onboarding/website-brand", json=data).status_code == 409
    job.status = job.stage = "completed"
    db.add(BrandExtractionResult(company_id=c["id"], job_id=job.id, extracted_data={
        "company_name": "Sample Bakery", "description": "A bakery of fresh sourdough breads.",
        "city": "Mumbai", "products_services": ["Fresh bread"], "suggested_content_tone": ["Friendly"],
    }, source_pages=[], source_evidence=[], warnings=[], model_identifier="test"))
    db.commit()
    for _ in range(2):
        assert client.post(root + "/onboarding/website-brand", json=data).status_code == 204
    brand = resource(client, c["id"], "brand")
    assert brand["display_name"] == "Sample Bakery"
    assert brand["source"] == "ai" and not brand["is_confirmed"]
    assert brand["products_services"] == ["Fresh bread"]
    assert not brand["logo_url"] and not brand["brand_colors"] and not brand["target_audience"]
    assert client.get(root).json()["city"] == "Pune"
    confirm(client, c["id"])
    assert client.post(root + "/onboarding/website-brand", json=data).status_code == 204
    assert resource(client, c["id"], "brand")["is_confirmed"]


def test_finalize_is_atomic_and_replays_the_same_generation(client, db, owner, configured):
    c = company(client, workspace(client)["id"])
    root = get_root(c["id"])
    assert client.post(root + "/onboarding/finalize", json=goals(client, c["id"])).status_code == 422
    confirm(client, c["id"])
    payload = goals(client, c["id"], platforms=["linkedin", "instagram", "x", "facebook"])
    first = client.post(root + "/onboarding/finalize", json=payload)
    assert first.is_success, first.text
    handoff = first.json()
    assert handoff["job_id"] and handoff["pending"]
    assert client.post(root + "/onboarding/finalize", json=payload).json() == handoff
    assert client.get(root + "/onboarding/first-post").json() == handoff
    assert resource(client, c["id"], "onboarding")["completed_steps"] == ["business", "brand", "preferences"]
    assert resource(client, c["id"], "onboarding")["status"] == "completed"
    assert client.get(root).json()["status"] == "active"
    prefs = resource(client, c["id"], "preferences")
    assert prefs["content_goals"] == ["lead_generation"]
    assert prefs["tone"] == ["bold"]
    assert prefs["platforms"] == payload["platforms"]
    jobs = db.scalars(select(AIJob).where(AIJob.company_id == c["id"])).all()
    job, = jobs
    assert job.payload["request"]["platforms"] == ["LinkedIn", "Instagram", "X"]
    assert job.payload["request"]["objective"] == "promotion"
    assert job.payload["request"]["tone"] == "bold"
    assert job.payload["request"]["content_type"] == "text"
    assert job.payload["context"]["description"] == c["description"]
    assert job.payload["context"]["preferences"]["goals"] == ["lead_generation"]
    assert client.get(root + "/onboarding/checklist").json() == {
        "brand": True, "post": False, "competitors": False, "accounts": False, "schedule": False,
    }
    outsider = User(full_name="Other company", email=f"{uuid4()}@example.com", hashed_password=owner.hashed_password)
    db.add(outsider)
    db.commit()
    client.cookies.set("access_token", create_access_token(outsider.id))
    for segment in ("first-post", "checklist"):
        assert client.get(root + "/onboarding/" + segment).status_code == 404
    assert client.post(root + "/onboarding/first-post", json={"job_id": handoff["job_id"]}).status_code == 404


def test_capacity_rejection_completes_setup_and_retries_without_duplicating(client, db, owner, configured, monkeypatch):
    c = company(client, workspace(client)["id"])
    root = get_root(c["id"])
    confirm(client, c["id"])
    monkeypatch.setattr(ai_settings, "hourly_company_limit", 0)
    first = client.post(root + "/onboarding/finalize", json=goals(client, c["id"], platforms=["facebook"]))
    assert first.is_success and first.json()["retryable"] and "limit" in first.json()["error"]
    assert resource(client, c["id"], "onboarding")["status"] == "completed"
    monkeypatch.setattr(ai_settings, "hourly_company_limit", 8)
    replacement = client.post(root + "/onboarding/first-post", json={"job_id": None}).json()
    assert replacement["job_id"] and replacement["pending"]
    assert client.post(root + "/onboarding/first-post", json={"job_id": None}).json() == replacement
    assert len(db.scalars(select(AIJob).where(AIJob.company_id == c["id"])).all()) == 1


def test_legacy_history_is_recovered_without_new_generation(client, db, owner, configured):
    c = company(client, workspace(client)["id"])
    root = get_root(c["id"])
    confirm(client, c["id"])
    assert complete_step(client, c["id"], "competitors").is_success
    job = AIJob(company_id=c["id"], requested_by=owner.id, kind="content_generation",
                request_key=uuid4(), payload={}, status="completed", stage="completed")
    db.add(job)
    db.commit()
    result = client.post(root + "/onboarding/finalize", json=goals(client, c["id"]))
    assert result.is_success and result.json()["job_id"] == str(job.id)
    assert len(db.scalars(select(AIJob).where(AIJob.company_id == c["id"])).all()) == 1
    assert "competitors" in resource(client, c["id"], "onboarding")["completed_steps"]


def test_retry_after_provider_failure_can_drop_image_work(client, db, owner, configured):
    c = company(client, workspace(client)["id"])
    root = get_root(c["id"])
    confirm(client, c["id"])
    prefs = resource(client, c["id"], "preferences")
    assert client.put(root + "/preferences", json={"revision": prefs["revision"], "content_formats": ["image_post"]}).is_success
    initial = client.post(root + "/onboarding/finalize", json=goals(client, c["id"], platforms=["instagram"])).json()
    job = db.scalar(select(AIJob).where(AIJob.company_id == c["id"]))
    assert job.payload["request"]["include_images"] is True
    job.status = job.stage = "failed"
    job.error_code = "openai_billing_limit"
    db.commit()
    assert client.get(root + "/onboarding/first-post").json()["retryable"]
    retry = {"job_id": initial["job_id"], "text_only": True}
    next_job = client.post(root + "/onboarding/first-post", json=retry).json()
    assert next_job["job_id"] != initial["job_id"]
    assert client.post(root + "/onboarding/first-post", json=retry).json() == next_job
    new = db.scalar(select(AIJob).where(AIJob.company_id == c["id"], AIJob.status == "queued"))
    assert new.payload["request"]["include_images"] is False
    assert resource(client, c["id"], "onboarding")["status"] == "completed"

