import asyncio
from datetime import timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.core.security import create_access_token
from app.models.intelligence import AIJob
from app.models.onboarding import WorkspaceMember
from app.models.trends import TrendNote
from app.models.user import User
from app.services import ai_queue, gemini_search, openai_search
from app.services.extraction_errors import ExtractionError
from app.services.extraction_jobs import now
from test_onboarding import company, owner, workspace


@pytest.fixture
def setup(client, owner, monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai")
    monkeypatch.setattr(openai_search, "enabled", lambda: True)
    space = workspace(client)
    record = company(client, space["id"], industry="Retail", country="India")
    root = f"/api/v1/companies/{record['id']}"
    assert client.post(root + "/brand/confirm", json={"revision": 1}).is_success
    return root, space


def note_body(**changes):
    return {
        "request_key": str(uuid4()), "title": "Packaging change",
        "source_url": "https://www.example.com/packaging",
        "finding": "We reviewed the new packaging requirements directly.",
        "published_on": "2025-01-01", "independently_reviewed": True,
        **changes,
    }


def test_notes_are_independent_idempotent_and_company_scoped(client, db, owner, setup):
    root, space = setup
    notes = root + "/trend-notes"
    assert client.post(notes, json=note_body(independently_reviewed=False)).status_code == 422
    assert client.post(notes, json=note_body(source_url="https://127.0.0.1/trend")).status_code == 422
    payload = note_body()
    saved = client.post(notes, json=payload)
    assert saved.status_code == 201, saved.text
    assert client.post(notes, json=payload).json() == saved.json()
    assert client.post(notes, json={**payload, "title": "Conflicting title"}).status_code == 409
    note_id = saved.json()["id"]
    other = company(client, space["id"])
    assert client.delete(f"/api/v1/companies/{other['id']}/trend-notes/{note_id}").status_code == 404
    assert client.get(notes).json()[0]["published_on"] == "2025-01-01"
    for _ in range(2):
        assert client.delete(f"{notes}/{note_id}").status_code == 204
    assert client.get(notes).json() == []
    assert db.scalar(select(TrendNote)).dismissed_at


def test_search_is_display_only_and_uses_approved_public_context(client, db, owner, setup, monkeypatch):
    root, _ = setup
    seen = []

    async def search(self, context, topic, days, note=None):
        seen.append((context, topic, days, note))
        self.usage = {"total_tokens": 100, "web_search_calls": 1}
        return gemini_search.GroundedAnswer(
            provider="openai", text="Reported evidence",
            sources=[gemini_search.SearchSource(uri="https://www.example.com/news", title="Source")],
            citations=[gemini_search.SearchCitation(start=0, end=17, source_indices=[0])],
            search_suggestions_html="",
        )

    monkeypatch.setattr(openai_search.OpenAIWebSearchProvider, "search_trends", search)
    note = client.post(root + "/trend-notes", json=note_body()).json()
    body = {"request_key": str(uuid4()), "topic": "Packaging", "days": 7, "note_id": note["id"]}
    response = client.post(root + "/trend-search", json=body)
    assert response.is_success, response.text
    assert response.json()["sources"][0]["uri"].endswith("/news")
    assert seen[0][:3] == ({"industry": "Retail", "country": "India"}, "Packaging", 7)
    assert seen[0][3]["finding"] == note["finding"]
    job = db.scalar(select(AIJob).where(AIJob.kind == "trend_search"))
    assert job.payload == {"mode": "display_only", "provider": "openai"}
    assert job.result == {"display_only": True, "provider": "openai"}
    assert job.token_usage["web_search_calls"] == 1
    assert client.post(root + "/trend-search", json=body).status_code == 409
    assert len(seen) == 1


def test_expired_trend_request_is_terminal_and_never_replayed(client, db, owner, setup):
    root, _ = setup
    company_id = UUID(root.rsplit("/", 1)[1])
    started = now() - timedelta(minutes=3)
    job = AIJob(company_id=company_id, requested_by=owner.id, kind="trend_search", request_key=uuid4(),
                payload={"mode": "display_only"}, status="running", stage="searching", attempt_count=1,
                started_at=started, lease_expires_at=started + timedelta(seconds=20), lease_token=uuid4())
    db.add(job)
    db.commit()
    assert ai_queue.claim(db, company_id=company_id) is None
    db.refresh(job)
    assert job.status == "failed" and job.error_code == "worker_interrupted"


def test_quota_and_membership_prevent_provider_calls(client, db, owner, setup, monkeypatch):
    root, space = setup

    async def blocked(*args):
        pytest.fail("Provider must not be called")

    monkeypatch.setattr(openai_search.OpenAIWebSearchProvider, "search_trends", blocked)
    monkeypatch.setattr(ai_settings, "hourly_company_limit", 0)
    payload = {"request_key": str(uuid4())}
    assert client.post(root + "/trend-search", json=payload).status_code == 429
    monkeypatch.setattr(openai_search, "enabled", lambda: False)
    assert client.post(root + "/trend-search", json=payload).status_code == 503

    member = User(full_name="Reader", email=f"{uuid4()}@example.com", hashed_password=owner.hashed_password)
    db.add(member)
    db.flush()
    db.add(WorkspaceMember(workspace_id=space["id"], user_id=member.id, role="member"))
    db.commit()
    client.cookies.set("access_token", create_access_token(member.id))
    assert client.get(root + "/trend-capabilities").json()["can_manage"] is False
    assert client.get(root + "/trend-notes").is_success
    assert client.post(root + "/trend-search", json=payload).status_code == 403
    assert client.post(root + "/trend-notes", json=note_body()).status_code == 403
    assert client.get(f"/api/v1/companies/{uuid4()}/trend-notes").status_code == 404


def test_trend_provider_bounds_tool_calls_and_requires_evidence(monkeypatch):
    monkeypatch.setattr(openai_search, "enabled", lambda: True)
    calls = []

    async def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status="completed", output=[])

    class Gateway:
        client = SimpleNamespace(responses=SimpleNamespace(create=create))

        async def call(self, fn, purpose):
            assert purpose == "search"
            return await fn()

    provider = openai_search.OpenAIWebSearchProvider(gateway=Gateway())
    with pytest.raises(ExtractionError, match="No public sources"):
        asyncio.run(provider.search_trends({"industry": "Retail"}, "Packaging", 7))
    assert calls[0]["store"] is False
    assert calls[0]["max_tool_calls"] == 4
    assert calls[0]["tools"][0]["type"] == "web_search"
    assert "linkedin.com" in calls[0]["tools"][0]["filters"]["blocked_domains"]

