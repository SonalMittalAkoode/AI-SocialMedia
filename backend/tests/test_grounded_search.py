import asyncio
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from google.genai import errors, types
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import settings
from app.core.intelligence_config import ai_settings as limits
from app.core.security import create_access_token
from app.models.intelligence import AIJob, Competitor, CompetitorResearch
from app.models.onboarding import WorkspaceMember
from app.models.user import User
from app.services import ai_queue, gemini_search as service
from app.services.extraction_errors import ExtractionError
from app.services.extraction_jobs import now
from test_competitor_intelligence import setup
from test_onboarding import owner, workspace, company


TEXT = "Example Engineering offers custom software for small teams."
WIDGET = '<style>.suggestion{padding:12px}</style><div class="suggestion"><a target="_blank" href="https://www.google.com/search?q=software">Search software</a></div>'


@pytest.fixture(autouse=True)
def fake_credentials(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "unit-test-key-not-live")
    monkeypatch.setattr(limits, "search_provider", "gemini")


def response(text=TEXT):
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(parts=[types.Part(text=text)]),
        grounding_metadata=types.GroundingMetadata(
            web_search_queries=["software competitors"],
            search_entry_point=types.SearchEntryPoint(rendered_content=WIDGET),
            grounding_chunks=[types.GroundingChunk(web=types.GroundingChunkWeb(uri="https://business.org", title="Example Engineering"))],
            grounding_supports=[types.GroundingSupport(
                segment=types.Segment(start_index=0, end_index=len(text.encode()), text=text), grounding_chunk_indices=[0])],
        ))])


def mock_client(side_effect=None):
    generate = AsyncMock(return_value=response(), side_effect=side_effect)
    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate))), generate


def test_official_sdk_tool_and_public_prompt(monkeypatch):
    client, generate = mock_client()
    context = {"company_name": "Our Engineering", "industry": "Software", "products_services": ["Custom systems"],
               "target_audience": "Small teams", "city": "Delhi", "country": "India", "description": "Practical systems",
               "preferences": {"instructions": "private-secret"}, "company_id": "private-id"}
    result = asyncio.run(service.GeminiGroundedSearchProvider(client).search(context))
    assert result.text == TEXT and result.search_suggestions_html == WIDGET
    call = generate.call_args.kwargs
    assert call["model"] == (limits.grounding_model or settings.GEMINI_MODEL)
    assert call["config"].tools[0].google_search is not None
    assert call["config"].response_json_schema is None
    assert "private-secret" not in call["contents"] and "private-id" not in call["contents"]
    assert all(value in call["contents"] for value in ["Our Engineering", "Software", "Small teams", "Delhi", "Practical systems"])


def test_grounding_metadata_and_unicode_normalization():
    result = service.parse_grounding(response("Café 🚀 develops software."))
    assert result.sources[0].uri == "https://business.org"
    assert result.citations[0].end == len("Café 🚀 develops software.".encode("utf-16-le")) // 2
    assert result.citations[0].source_indices == [0]


def test_multipart_citations_keep_original_offsets():
    data = response()
    data.candidates[0].content.parts.insert(0, types.Part(text="Introduction. "))
    data.candidates[0].grounding_metadata.grounding_supports[0].segment.part_index = 1
    result = service.parse_grounding(data)
    assert result.text == "Introduction. " + TEXT
    assert result.citations[0].start == len("Introduction. ")


def test_truncated_answer_is_not_displayed_as_complete():
    data = response()
    data.candidates[0].finish_reason = types.FinishReason.MAX_TOKENS
    with pytest.raises(ExtractionError):
        service.parse_grounding(data)


@pytest.mark.parametrize("missing", ["sources", "supports", "suggestions", "content", "unsafe_source", "bad_index"])
def test_missing_or_unsafe_evidence_is_not_presented_as_grounded(missing):
    data = response()
    meta = data.candidates[0].grounding_metadata
    if missing == "sources": meta.grounding_chunks = []
    if missing == "supports": meta.grounding_supports = []
    if missing == "suggestions": meta.search_entry_point = None
    if missing == "content": data.candidates[0].content = None
    if missing == "unsafe_source": meta.grounding_chunks[0].web.uri = "http://127.0.0.1"
    if missing == "bad_index": meta.grounding_supports[0].grounding_chunk_indices = [90]
    with pytest.raises(ExtractionError) as exc:
        service.parse_grounding(data)
    assert exc.value.code == "search_missing_evidence"


def test_duplicate_sources_preserve_citation_mapping():
    data = response()
    meta = data.candidates[0].grounding_metadata
    meta.grounding_chunks.append(meta.grounding_chunks[0])
    meta.grounding_supports[0].grounding_chunk_indices = [0, 1]
    result = service.parse_grounding(data)
    assert len(result.sources) == 1 and result.citations[0].source_indices == [0]


@pytest.mark.parametrize("code,expected", [(429,"search_rate_limited"),(403,"search_access_denied"),(400,"search_model_unsupported"),(500,"search_unavailable")])
def test_provider_errors_are_bounded_and_secret_free(monkeypatch, code, expected):
    monkeypatch.setattr(limits, "grounding_max_attempts", 1)
    error = errors.APIError(code, {"error": {"message": "provider-secret-do-not-leak", "status": "TEST"}})
    client, generate = mock_client(error)
    with pytest.raises(ExtractionError) as exc:
        asyncio.run(service.GeminiGroundedSearchProvider(client).search({}))
    assert exc.value.code == expected and "provider-secret" not in exc.value.message
    assert generate.await_count == 1


def test_retry_only_transient_errors_within_cap(monkeypatch):
    monkeypatch.setattr(limits, "grounding_max_attempts", 2)
    client, generate = mock_client([errors.APIError(503, {"error":{"message":"busy"}}), response()])
    assert asyncio.run(service.GeminiGroundedSearchProvider(client).search({})).display_only
    assert generate.await_count == 2


def test_no_gemini_key_never_calls_provider(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    client, generate = mock_client()
    with pytest.raises(ExtractionError) as exc:
        asyncio.run(service.GeminiGroundedSearchProvider(client).search({}))
    assert exc.value.code == "search_provider_not_configured" and generate.await_count == 0


def test_owned_client_pins_search_compatible_api_version(monkeypatch):
    client, _ = mock_client()
    client.aio.aclose = AsyncMock()
    captured = {}
    def factory(**kwargs):
        captured.update(kwargs)
        return client
    monkeypatch.setattr(service.genai, "Client", factory)
    asyncio.run(service.GeminiGroundedSearchProvider().search({}))
    assert captured["http_options"].api_version == "v1beta"
    assert captured["http_options"].retry_options.attempts == 1
    client.aio.aclose.assert_awaited_once()


def test_timeout_remains_a_safe_terminal_failure():
    client, generate = mock_client(TimeoutError())
    with pytest.raises(ExtractionError) as exc:
        asyncio.run(service.GeminiGroundedSearchProvider(client).search({}))
    assert exc.value.code == "search_timeout" and generate.await_count == 1


def test_display_only_api_does_not_persist_or_crawl(client, db, setup, monkeypatch):
    c, root = setup
    monkeypatch.setattr(limits, "brave_search_api_key", None)
    search = AsyncMock(return_value=service.parse_grounding(response()))
    crawl = AsyncMock(side_effect=AssertionError("Grounded links must not be crawled"))
    monkeypatch.setattr(service.GeminiGroundedSearchProvider, "search", search)
    monkeypatch.setattr("app.services.competitor_intelligence.extract_website", crawl)
    monkeypatch.setattr("app.services.website_extraction.extract_website", crawl)
    caps = client.get(root + "/ai-capabilities").json()
    assert caps["search_available"] and caps["search_provider"] == "gemini" and not caps["brave_discovery_available"]
    key = str(uuid4())
    result = client.post(root + "/competitor-search", json={"request_key": key})
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["text"] == TEXT and result.json()["search_suggestions_html"] == WIDGET
    assert db.scalar(select(func.count()).select_from(Competitor).where(Competitor.company_id == c["id"])) == 0
    assert db.scalar(select(func.count()).select_from(CompetitorResearch).where(CompetitorResearch.company_id == c["id"])) == 0
    job = db.scalar(select(AIJob).where(AIJob.company_id == c["id"]))
    assert job.status == "completed" and job.result == {"provider":"gemini", "display_only":True}
    assert TEXT not in json.dumps(job.result) and WIDGET not in json.dumps(job.payload)
    assert client.post(root + "/competitor-search", json={"request_key": key}).status_code == 409
    assert search.await_count == 1 and crawl.await_count == 0
    assert "search_suggestions_html" not in client.get(root + f"/ai-jobs/{job.id}").text
    assert client.post(root + "/competitor-discoveries", json={"request_key":str(uuid4())}).status_code == 503


def test_request_limits_apply_before_provider(client, setup, monkeypatch):
    _, root = setup
    monkeypatch.setattr(limits, "hourly_company_limit", 1)
    search = AsyncMock(return_value=service.parse_grounding(response()))
    monkeypatch.setattr(service.GeminiGroundedSearchProvider, "search", search)
    assert client.post(root + "/competitor-search", json={"request_key":str(uuid4())}).status_code == 200
    assert client.post(root + "/competitor-search", json={"request_key":str(uuid4())}).status_code == 429
    assert search.await_count == 1


def test_failure_metadata_and_no_automatic_retry_job(client, db, setup, monkeypatch):
    c, root = setup
    monkeypatch.setattr(service.GeminiGroundedSearchProvider, "search", AsyncMock(side_effect=ExtractionError("search_rate_limited", "Try later")))
    result = client.post(root + "/competitor-search", json={"request_key":str(uuid4())})
    assert result.status_code == 429
    job = db.scalar(select(AIJob).where(AIJob.company_id == c["id"]))
    assert job.status == "failed" and job.error_code == "search_rate_limited"
    assert ai_queue.claim(db, company_id=c["id"]) is None


def test_tenant_and_viewer_cannot_submit_live_search(client, db, owner, setup, monkeypatch):
    c, root = setup
    search = AsyncMock()
    monkeypatch.setattr(service.GeminiGroundedSearchProvider, "search", search)
    other = User(full_name="Search reader", email=f"search-{uuid4()}@example.com", hashed_password=owner.hashed_password)
    db.add(other); db.commit()
    client.cookies.set("access_token", create_access_token(other.id))
    assert client.post(root + "/competitor-search", json={"request_key":str(uuid4())}).status_code == 404
    db.add(WorkspaceMember(workspace_id=c["workspace_id"], user_id=other.id, role="member")); db.commit()
    assert client.post(root + "/competitor-search", json={"request_key":str(uuid4())}).status_code == 403
    assert search.await_count == 0


def test_interrupted_display_search_is_never_replayed(client, db, owner, setup):
    c, _ = setup
    record = db.get(__import__('app.models.onboarding', fromlist=['Company']).Company, c["id"])
    request_id = service.begin_request(db, record, owner, uuid4(), {})
    job = db.get(AIJob, request_id)
    job.lease_expires_at = now() - timedelta(seconds=1)
    db.commit()
    assert ai_queue.claim(db, company_id=c["id"]) is None
    assert db.get(AIJob, request_id).status == "failed"


def test_brave_requires_explicit_license_confirmation(client, setup, monkeypatch):
    _, root = setup
    monkeypatch.setattr(limits, "search_provider", "brave")
    monkeypatch.setattr(limits, "brave_search_api_key", SecretStr("test-only"))
    monkeypatch.setattr(limits, "brave_research_license_confirmed", False)
    assert not client.get(root + "/ai-capabilities").json()["search_available"]
    assert client.post(root + "/competitor-discoveries", json={"request_key":str(uuid4())}).status_code == 503
    monkeypatch.setattr(limits, "brave_research_license_confirmed", True)
    assert client.post(root + "/competitor-discoveries", json={"request_key":str(uuid4())}).status_code == 202
