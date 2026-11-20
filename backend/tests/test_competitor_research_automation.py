"""Automated independent competitor research: bulk, batches, edit/remove, assessment, isolation.

All Gemini and website calls are mocked; PostgreSQL is real and rolled back.
"""
import asyncio
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from app.core.intelligence_config import ai_settings as limits
from app.core.security import create_access_token
from app.models.intelligence import AIJob, Competitor, CompetitorResearch
from app.models.user import User
from app.schemas.brand_extraction import BrandAnalysis, Evidence
from app.services import ai_queue, competitor_intelligence as service
from app.services.competitor_analysis import CompetitiveAssessment, Strength, Opportunity, validate, facts_from
from app.services.extraction_errors import ExtractionError
from app.services.extraction_jobs import now
from app.workers.intelligence import run_job
from test_onboarding import owner, workspace, company  # noqa: F401


@pytest.fixture
def setup(client, owner):
    c = company(client, workspace(client)["id"])
    root = f"/api/v1/companies/{c['id']}"
    assert client.post(root + "/brand/confirm", json={"revision": 1}).status_code == 200
    return c, root


def add(client, root, name, url):
    response = client.post(root + "/competitors", json={"name": name, "website_url": url})
    assert response.status_code == 201, response.text
    return response.json()


def analysis_for(name, url="https://alpha.org"):
    return BrandAnalysis(
        company_name=name, description="Alpha builds engineering software for teams.",
        products_services=["Engineering software"],
        field_evidence=[
            Evidence(field="company_name", value=name, source_url=url, supporting_text=name, classification="explicit", confidence="high"),
            Evidence(field="description", value="Alpha builds engineering software for teams.", source_url=url, supporting_text="Alpha builds engineering software for teams.", classification="explicit", confidence="high"),
            Evidence(field="products_services", value="Engineering software", source_url=url, supporting_text="Engineering software", classification="explicit", confidence="high"),
        ])


def assessment(basis="Engineering software"):
    return CompetitiveAssessment(
        market_positioning="Positions itself as a specialist engineering partner.",
        target_audience=["Product teams"], content_themes=["Engineering quality"],
        competitive_strengths=[Strength(observation="Clear specialist offer", basis=basis), Strength(observation="Invented", basis="Not a fact anywhere")],
        content_opportunities=[Opportunity(suggestion="Show behind-the-scenes process", rationale="Differentiates on transparency")],
        fit_score=80, fit_rationale="Same audience and offering.")


@contextmanager
def session(db):
    yield db


def factory_for(db):
    @contextmanager
    def factory():
        yield db
    return factory


# ---------- bulk add and bulk research ----------

def test_bulk_add_reports_each_row_and_prevents_duplicates(client, setup):
    _, root = setup
    existing = add(client, root, "Existing Co", "https://existing.org")
    response = client.post(root + "/competitors/bulk", json={"request_key": str(uuid4()), "competitors": [
        {"name": "Alpha Engineering", "website_url": "https://alpha.org"},
        {"name": "Alpha Again", "website_url": "https://www.alpha.org/about"},
        {"name": "Existing Co", "website_url": "https://existing.org"},
        {"name": "Local", "website_url": "http://localhost"},
        {"name": "X", "website_url": "https://beta.org"},
    ]})
    assert response.status_code == 200, response.text
    statuses = [i["status"] for i in response.json()["items"]]
    assert statuses == ["created", "invalid", "existing", "invalid", "invalid"]
    assert response.json()["items"][2]["competitor"]["id"] == existing["id"]
    assert response.json()["batch"] is None
    assert len(client.get(root + "/competitors").json()) == 2


def test_bulk_add_with_research_queues_one_job_per_competitor(client, db, setup):
    c, root = setup
    key = str(uuid4())
    response = client.post(root + "/competitors/bulk", json={"request_key": key, "research": True, "competitors": [
        {"name": "Alpha Engineering", "website_url": "https://alpha.org"},
        {"name": "Beta Engineering", "website_url": "https://beta.org"},
        {"name": "Gamma Engineering", "website_url": "https://gamma.org"}]})
    batch = response.json()["batch"]
    assert batch["total"] == 3 and batch["queued"] == 3 and batch["batch_id"] == key
    # Distinct targets may be active concurrently under the new targeted unique index.
    active = db.scalar(select(func.count()).select_from(AIJob).where(AIJob.company_id == c["id"], AIJob.status == "queued", AIJob.kind == "competitor_research"))
    assert active == 3
    status = client.get(root + f"/competitor-research-batches/{key}").json()
    assert status["total"] == 3 and {j["target_key"] for j in status["jobs"]} == {r["competitor"]["id"] for r in response.json()["items"]}
    rows = client.get(root + "/competitors").json()
    assert all(r["research_job"]["status"] == "queued" for r in rows)


def test_bulk_research_is_idempotent_and_reuses_active_targets(client, setup):
    _, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    b = add(client, root, "Beta Engineering", "https://beta.org")
    key = str(uuid4())
    first = client.post(root + "/competitors/research-batch", json={"request_key": key, "competitor_ids": [a["id"], b["id"]]})
    assert first.status_code == 202 and first.json()["total"] == 2
    replay = client.post(root + "/competitors/research-batch", json={"request_key": key, "competitor_ids": [a["id"], b["id"]]})
    assert [j["id"] for j in replay.json()["jobs"]] == [j["id"] for j in first.json()["jobs"]]
    single = client.post(root + f"/competitors/{a['id']}/research", json={"request_key": str(uuid4())})
    assert single.json()["id"] == first.json()["jobs"][0]["id"]


def test_batch_admission_is_atomic(client, db, setup, monkeypatch):
    c, root = setup
    ids = [add(client, root, f"Company {n} Engineering", f"https://company{n}.org")["id"] for n in range(3)]
    monkeypatch.setattr(limits, "hourly_company_limit", 2)
    response = client.post(root + "/competitors/research-batch", json={"request_key": str(uuid4()), "competitor_ids": ids})
    assert response.status_code == 429 and "remain" in response.json()["detail"]
    assert db.scalar(select(func.count()).select_from(AIJob).where(AIJob.company_id == c["id"])) == 0
    monkeypatch.setattr(limits, "max_bulk_research", 2)
    assert client.post(root + "/competitors/research-batch", json={"request_key": str(uuid4()), "competitor_ids": ids}).status_code == 422


def test_unknown_batch_and_foreign_ids(client, setup):
    _, root = setup
    assert client.get(root + f"/competitor-research-batches/{uuid4()}").status_code == 404
    assert client.post(root + "/competitors/research-batch", json={"request_key": str(uuid4()), "competitor_ids": [str(uuid4())]}).status_code == 404


# ---------- edit, remove, restore ----------

def test_full_edit_and_website_change_resets_verification(client, db, setup):
    _, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    b = add(client, root, "Beta Engineering", "https://beta.org")
    row = db.get(Competitor, a["id"]); row.verification_status = "verified"; row.relevance_score = 70; db.commit()
    url = root + f"/competitors/{a['id']}"
    current = client.get(url).json()
    edited = client.patch(url, json={"revision": current["revision"], "industry": "Software", "description": "Edited", "city": "Pune", "country": "India"})
    assert edited.status_code == 200 and edited.json()["industry"] == "Software" and edited.json()["verification_status"] == "verified"
    assert client.patch(url, json={"revision": edited.json()["revision"], "website_url": "https://beta.org"}).status_code == 409
    moved = client.patch(url, json={"revision": edited.json()["revision"], "website_url": "https://alpha-new.org"})
    assert moved.status_code == 200 and moved.json()["verification_status"] == "unverified" and moved.json()["relevance_score"] == 0
    assert client.patch(url, json={"revision": moved.json()["revision"], "website_url": "http://localhost"}).status_code == 422
    assert b["id"] != a["id"]


def test_remove_restore_preserves_history_and_blocks_use(client, db, setup):
    c, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    url = root + f"/competitors/{a['id']}"
    approved = client.patch(url, json={"revision": 1, "selection_status": "approved"}).json()
    removed = client.post(url + "/remove", json={"revision": approved["revision"]})
    assert removed.status_code == 200 and removed.json()["removed_at"]
    assert client.get(root + "/competitors").json() == []
    assert len(client.get(root + "/competitors?include_removed=true").json()) == 1
    assert client.post(url + "/research", json={"request_key": str(uuid4())}).status_code == 422
    assert client.patch(url, json={"revision": removed.json()["revision"], "name": "New name"}).status_code == 422
    assert service.approved_count(db, c["id"]) == 0
    assert db.get(Competitor, a["id"]) is not None  # never hard-deleted
    restored = client.post(url + "/restore", json={"revision": removed.json()["revision"]})
    assert restored.status_code == 200 and restored.json()["removed_at"] is None
    assert client.post(url + "/remove", json={"revision": 1}).status_code == 409
    client.post(url + "/remove", json={"revision": restored.json()["revision"]})
    readd = client.post(root + "/competitors", json={"name": "Alpha Engineering", "website_url": "https://alpha.org"})
    assert readd.json()["id"] == a["id"] and readd.json()["removed_at"] is None


# ---------- research composition ----------

def test_research_combines_verified_facts_and_validated_assessment():
    assessor = AsyncMock(return_value=(validate(assessment(), facts_from(analysis_for("Alpha Engineering").model_dump(mode="json"))), {"prompt_token_count": 5, "candidates_token_count": 7, "total_token_count": 12}))
    analyzer = SimpleNamespace(analyze=AsyncMock(return_value=(analysis_for("Alpha Engineering"), {"prompt_tokens": 1, "output_tokens": 2, "total_tokens": 3})))
    stages = []
    context = {"industry": "Engineering", "products_services": ["Engineering software"], "description": "We build engineering software"}
    result, usage = asyncio.run(service.research({"name": "Alpha Engineering", "website_url": "https://alpha.org"}, context, analyzer,
                                                 extractor=AsyncMock(return_value={"pages": []}), stage=stages.append, assessor=assessor))
    assert stages == ["fetching", "analyzing", "assessing"]
    assert result["verification_status"] == "verified" and result["assessment_status"] == "completed"
    assert result["market_positioning"].startswith("Positions") and result["fit"]["score"] == 80
    interpreted = [s for s in result["strengths"] if s["classification"] == "interpretation"]
    assert [s["basis"] for s in interpreted] == ["Engineering software"]  # invented basis dropped
    assert result["content_opportunities"][0]["classification"] == "strategic_suggestion"
    assert result["metrics"] == {"engagement_rate": None, "followers": None, "posting_frequency": None}
    assert usage["total_tokens"] == 15
    assert 0 <= result["relevance_score"] <= 100 and "AI fit assessment 80/100" in result["relevance_reason"]


def test_assessment_failure_keeps_partial_website_findings():
    assessor = AsyncMock(side_effect=ExtractionError("gemini_quota", "Quota"))
    analyzer = SimpleNamespace(analyze=AsyncMock(return_value=(analysis_for("Alpha Engineering"), {})))
    result, _ = asyncio.run(service.research({"name": "Alpha Engineering", "website_url": "https://alpha.org"}, {}, analyzer,
                                             extractor=AsyncMock(return_value={"pages": []}), assessor=assessor))
    assert result["assessment_status"] == "unavailable" and result["fit"] is None
    assert result["products_services"] == ["Engineering software"]
    assert any("partial result" in w for w in result["warnings"])


def test_assessment_rejects_strengths_without_validated_basis():
    facts = facts_from(analysis_for("Alpha Engineering").model_dump(mode="json"))
    with pytest.raises(ValueError):
        validate(assessment().model_copy(update={"competitive_strengths": [Strength(observation="x y z", basis="Nowhere")]}), facts)
    # Suggested-only fields are separated from verified facts.
    data = analysis_for("Alpha Engineering").model_dump(mode="json")
    data["content_pillars"] = ["Inferred pillar"]
    assert "content_pillars" not in facts_from(data) and facts_from(data)["unverified_site_signals"]["content_pillars"] == ["Inferred pillar"]


# ---------- worker durability and races ----------

def _queue(client, root, competitor):
    return client.post(root + f"/competitors/{competitor['id']}/research", json={"request_key": str(uuid4())}).json()


def test_research_survives_worker_restart_and_completes(client, db, setup):
    c, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    job = _queue(client, root, a)
    first = ai_queue.claim(db, company_id=c["id"])
    # Simulate a crashed worker: lease expires without completion.
    row = db.get(AIJob, job["id"]); row.lease_expires_at = now() - timedelta(seconds=1); db.commit()
    assert ai_queue.claim(db, company_id=c["id"]) is None  # requeued with backoff, not lost
    row = db.get(AIJob, job["id"]); assert row.status == "queued"
    row.available_at = now() - timedelta(seconds=1); db.commit()
    second = ai_queue.claim(db, company_id=c["id"])
    assert second[0] == first[0] and second[1] != first[1]
    analyzer = SimpleNamespace(analyze=AsyncMock(return_value=(analysis_for("Alpha Engineering"), {})))
    asyncio.run(run_job(first, analyzer, session_factory=factory_for(db), extractor=AsyncMock(return_value={"pages": []})))
    assert db.get(AIJob, job["id"]).status == "running"  # stale lease cannot complete it
    asyncio.run(run_job(second, analyzer, session_factory=factory_for(db), extractor=AsyncMock(return_value={"pages": []})))
    assert db.get(AIJob, job["id"]).status == "completed"
    saved = client.get(root + "/competitors").json()[0]
    assert saved["verification_status"] == "verified" and saved["last_researched_at"] and saved["research_job"]["status"] == "completed"
    insights = client.get(root + f"/competitor-insights?competitor_id={a['id']}").json()
    assert len(insights) == 1 and insights[0]["data"]["business"]["company_name"] == "Alpha Engineering"


def test_removed_during_research_is_not_saved(client, db, setup):
    c, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    job = _queue(client, root, a)
    claimed = ai_queue.claim(db, company_id=c["id"])
    client.post(root + f"/competitors/{a['id']}/remove", json={"revision": 1})
    analyzer = SimpleNamespace(analyze=AsyncMock(return_value=(analysis_for("Alpha Engineering"), {})))
    asyncio.run(run_job(claimed, analyzer, session_factory=factory_for(db), extractor=AsyncMock(return_value={"pages": []})))
    assert db.get(AIJob, job["id"]).error_code == "competitor_unavailable"
    assert db.scalar(select(func.count()).select_from(CompetitorResearch).where(CompetitorResearch.competitor_id == a["id"])) == 0


def test_reanalysis_bypasses_cache(client, db, setup):
    c, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    job = _queue(client, root, a)
    claimed = ai_queue.claim(db, company_id=c["id"])
    analyzer = SimpleNamespace(analyze=AsyncMock(return_value=(analysis_for("Alpha Engineering"), {})))
    asyncio.run(run_job(claimed, analyzer, session_factory=factory_for(db), extractor=AsyncMock(return_value={"pages": []})))
    cached = _queue(client, root, a)
    assert cached["id"] == job["id"] and cached["status"] == "completed"
    fresh = client.post(root + f"/competitors/{a['id']}/research", json={"request_key": str(uuid4()), "force": True}).json()
    assert fresh["id"] != job["id"] and fresh["status"] == "queued"


# ---------- generation context ----------

def test_approved_researched_insights_feed_generation_context(client, db, owner, setup):
    c, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    b = add(client, root, "Beta Engineering", "https://beta.org")
    for record, verification in ((a, "partially_verified"), (b, "verified")):
        job = AIJob(company_id=c["id"], requested_by=owner.id, kind="competitor_research", request_key=uuid4(), payload={}, status="completed")
        db.add(job); db.flush()
        db.add(CompetitorResearch(company_id=c["id"], competitor_id=record["id"], job_id=job.id, model_identifier="test",
                                  data={"market_positioning": "Specialist", "content_themes": ["Quality"], "content_opportunities": [{"suggestion": "Show process"}], "products_services": ["Software"]},
                                  source_evidence=[{"source_url": "https://alpha.org"}]))
        row = db.get(Competitor, record["id"]); row.verification_status = verification; row.selection_status = "approved"
    db.commit()
    insights = service.approved_insights(db, c["id"])
    assert {i["name"] for i in insights} == {"Alpha Engineering", "Beta Engineering"}
    capabilities = client.get(root + "/ai-capabilities").json()
    assert capabilities["can_manage_competitors"] is True
    assert set(capabilities["content_eligible_competitor_ids"]) == {a["id"], b["id"]}
    assert insights[0]["opportunities"] == ["Show process"] and insights[0]["positioning"] == "Specialist"
    removed = db.get(Competitor, a["id"]); removed.removed_at = now(); db.commit()
    assert [i["name"] for i in service.approved_insights(db, c["id"])] == ["Beta Engineering"]
    from app.services.content_generation import context_for, strategy
    from app.models.onboarding import Company
    context = context_for(db, db.get(Company, c["id"]))
    plan = strategy(context, {"topic": "Launch", "platforms": ["LinkedIn"], "content_type": "educational"})
    assert plan["competitor_opportunities"][0]["name"] == "Beta Engineering"
    from app.models.onboarding import WorkspaceMember
    membership = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == c["workspace_id"], WorkspaceMember.user_id == owner.id))
    membership.role = "member"
    db.commit()
    capabilities = client.get(root + "/ai-capabilities").json()
    assert capabilities["can_manage_competitors"] is False
    assert capabilities["content_eligible_competitor_ids"] == [b["id"]]
    assert client.post(root + f"/competitors/{b['id']}/research", json={"request_key": str(uuid4())}).status_code == 403


# ---------- tenant isolation ----------

def test_new_routes_are_tenant_isolated(client, db, owner, setup):
    _, root = setup
    a = add(client, root, "Alpha Engineering", "https://alpha.org")
    key = str(uuid4())
    client.post(root + "/competitors/research-batch", json={"request_key": key, "competitor_ids": [a["id"]]})
    other = User(full_name="Other", email=f"other-{uuid4().hex}@example.com", hashed_password=owner.hashed_password)
    db.add(other); db.commit(); client.cookies.set("access_token", create_access_token(other.id))
    assert client.get(root + "/ai-capabilities").status_code == 404
    assert client.get(root + f"/competitor-research-batches/{key}").status_code == 404
    assert client.post(root + "/competitors/research-batch", json={"request_key": str(uuid4()), "competitor_ids": [a["id"]]}).status_code == 404
    assert client.post(root + "/competitors/bulk", json={"request_key": str(uuid4()), "competitors": [{"name": "Intruder Co", "website_url": "https://intruder.org"}]}).status_code == 404
    for action in ("remove", "restore"):
        assert client.post(root + f"/competitors/{a['id']}/{action}", json={"revision": 1}).status_code == 404
    assert client.get(root + f"/competitor-insights?competitor_id={a['id']}").status_code == 404


# ---------- lenient evidence pruning and redirect policy ----------

def _site(text, url="https://alpha.org"):
    return {"requested_url": url, "social_links": {}, "pages": [{"url": url, "title": None, "description": None, "og_title": None, "og_description": None, "headings": [], "cleaned_text": text, "contacts": [], "social_links": {}, "structured_data": []}]}


def test_lenient_analysis_prunes_unsupported_values_instead_of_rejecting():
    from app.services.gemini_brand_analyzer import GeminiAnalysis, Citation, analysis_sources, attach_evidence, attach_evidence_lenient, prune_unsupported, verify_evidence
    site = _site("Alpha Engineering\nWe build engineering software for product teams.")
    passages = analysis_sources(site)
    wire = GeminiAnalysis(company_name="Alpha Engineering", description="Builds software for product teams", products_services=["Engineering software", "Invented consulting"],
                          field_evidence=[Citation(field="company_name", value="Alpha Engineering", source_id="S0", classification="explicit", confidence="high"),
                                          Citation(field="description", value="Builds software", source_id="S1", classification="explicit", confidence="medium"),
                                          Citation(field="products_services", value="Engineering software", source_id="S1", classification="explicit", confidence="high")])
    with pytest.raises(ValueError):  # strict path keeps rejecting (brand extraction unchanged)
        verify_evidence(attach_evidence(wire, passages), site)
    result = prune_unsupported(attach_evidence_lenient(wire, passages), site)
    assert result.company_name == "Alpha Engineering" and result.products_services == ["Engineering software"]
    assert any(e.field == "description" and e.classification == "inferred" for e in result.field_evidence)
    assert any("omitted" in w for w in result.warnings)
    empty = GeminiAnalysis(company_name="Ghost", field_evidence=[Citation(field="company_name", value="Ghost", source_id="S99", classification="explicit", confidence="high")])
    with pytest.raises(ValueError):
        prune_unsupported(attach_evidence_lenient(empty, passages), site)


def test_research_follows_same_domain_redirect_only():
    def redirect(to):
        error = ExtractionError("external_redirect", "redirect"); error.redirect_to = to; return error
    extractor = AsyncMock(side_effect=[redirect("https://www.alpha.org/"), {"pages": []}])
    assert asyncio.run(service.fetch_competitor_site("https://alpha.org", extractor)) == {"pages": []}
    assert extractor.await_args_list[1].args[0] == "https://www.alpha.org/"
    with pytest.raises(ExtractionError) as error:
        asyncio.run(service.fetch_competitor_site("https://alpha.io", AsyncMock(side_effect=redirect("https://alpha.co/"))))
    assert "alpha.co" in error.value.message
    with pytest.raises(ExtractionError) as error:
        asyncio.run(service.fetch_competitor_site("https://alpha.org", AsyncMock(side_effect=ExtractionError("website_error", "HTTP 500"))))
    assert error.value.code == "website_error"
