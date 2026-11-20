"""OpenAI provider tests. Every OpenAI response is mocked: no credits are spent."""
import asyncio
import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import openai
import pytest
from PIL import Image
from pydantic import SecretStr

from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services import ai_provider, openai_provider
from app.services.extraction_errors import ExtractionError
from app.services.openai_images import OpenAIImageProvider, SIZES
from app.services.openai_provider import OpenAIGateway, map_error, strict_schema
from app.services.openai_search import OpenAIWebSearchProvider, parse_response

pytestmark = pytest.mark.openai_provider


@pytest.fixture(autouse=True)
def openai_selected(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", SecretStr("sk-test-not-real"))
    monkeypatch.setattr(settings, "OPENAI_TEXT_MODEL", "text-model-test")
    monkeypatch.setattr(settings, "OPENAI_RESEARCH_MODEL", "research-model-test")
    monkeypatch.setattr(settings, "OPENAI_IMAGE_MODEL", "image-model-test")
    monkeypatch.setattr(settings, "OPENAI_PREMIUM_IMAGE_MODEL", "premium-image-model-test")
    monkeypatch.setattr(settings, "OPENAI_WEB_SEARCH_ENABLED", True)
    monkeypatch.setattr(ai_settings, "openai_max_attempts", 2)
    monkeypatch.setattr(openai_provider.asyncio, "sleep", AsyncMock())


def status_error(cls, status, code=None, kind=None, headers=None):
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(status, request=request, headers=headers or {})
    return cls("provider detail with private text", response=response, body={"error": {"code": code, "type": kind, "message": "private"}})


def usage(**extra):
    return SimpleNamespace(input_tokens=120, output_tokens=40, total_tokens=160,
                           input_tokens_details=SimpleNamespace(cached_tokens=0),
                           output_tokens_details=SimpleNamespace(reasoning_tokens=12), **extra)


def text_response(payload, status="completed", refusal=False):
    content = [SimpleNamespace(type="refusal", refusal="no")] if refusal else [SimpleNamespace(type="output_text", text=json.dumps(payload), annotations=[])]
    return SimpleNamespace(id="resp_test", model="text-model-test-2026", status=status, usage=usage(),
                           output=[SimpleNamespace(type="message", content=content)],
                           output_text="" if refusal else json.dumps(payload))


def gateway_with(create):
    return OpenAIGateway(client=SimpleNamespace(responses=SimpleNamespace(create=create), close=AsyncMock()))


# --- schema, errors and retries -------------------------------------------------------------

def test_strict_schema_requires_every_field_and_converts_enum_maps():
    from app.services.gemini_brand_analyzer import GeminiAnalysis
    wire, strict = strict_schema(GeminiAnalysis.model_json_schema())
    assert strict is True
    social = wire["properties"]["social_links"]
    assert social["additionalProperties"] is False and set(social["required"]) == {"instagram", "facebook", "linkedin", "x"}
    def walk(node):
        if isinstance(node, dict):
            assert not {"maxLength", "maxItems", "pattern", "propertyNames", "default"} & set(node)
            if node.get("type") == "object":
                assert node["additionalProperties"] is False and node["required"] == list(node["properties"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(wire)


def test_free_form_maps_fall_back_to_non_strict_schema():
    _, strict = strict_schema({"type": "object", "properties": {"m": {"type": "object", "additionalProperties": {"type": "string"}}}})
    assert strict is False


@pytest.mark.parametrize("exc,code,transient", [
    (status_error(openai.AuthenticationError, 401), "openai_auth_failed", False),
    (status_error(openai.PermissionDeniedError, 403), "openai_access_denied", False),
    (status_error(openai.NotFoundError, 404, "model_not_found"), "openai_model_unavailable", False),
    (status_error(openai.RateLimitError, 429, "rate_limit_exceeded"), "openai_rate_limited", True),
    (status_error(openai.RateLimitError, 429, "insufficient_quota", "insufficient_quota"), "openai_billing_limit", False),
    (status_error(openai.RateLimitError, 429, "project_spend_limit_exceeded"), "openai_billing_limit", False),
    (status_error(openai.RateLimitError, 429, "credit_balance_exhausted"), "openai_billing_limit", False),
    (status_error(openai.BadRequestError, 400, "moderation_blocked"), "openai_content_blocked", False),
    (status_error(openai.BadRequestError, 400, "invalid_json_schema"), "openai_request_rejected", False),
    (status_error(openai.InternalServerError, 503), "openai_unavailable", True),
    (openai.APITimeoutError(request=httpx.Request("POST", "https://api.openai.com")), "openai_timeout", True),
])
def test_error_mapping_is_fixed_and_never_echoes_provider_text(exc, code, transient):
    error = map_error(exc)
    assert (error.code, error.transient) == (code, transient)
    assert "private" not in error.message and "sk-" not in error.message


def test_billing_errors_are_never_retried_but_transient_errors_are_bounded():
    billing = AsyncMock(side_effect=status_error(openai.RateLimitError, 429, "insufficient_quota", "insufficient_quota"))
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(gateway_with(billing).call(billing))
    assert caught.value.code == "openai_billing_limit" and billing.await_count == 1
    flaky = AsyncMock(side_effect=status_error(openai.InternalServerError, 503))
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(gateway_with(flaky).call(flaky))
    assert caught.value.code == "openai_unavailable" and flaky.await_count == ai_settings.openai_max_attempts
    recovered = AsyncMock(side_effect=[status_error(openai.RateLimitError, 429, "rate_limit_exceeded", headers={"retry-after": "1"}), "ok"])
    assert asyncio.run(gateway_with(recovered).call(recovered)) == "ok"


def test_structured_call_uses_responses_api_with_strict_json_schema_and_records_usage():
    create = AsyncMock(return_value=text_response({"a": "b"}))
    gateway = gateway_with(create)
    text, used, meta = asyncio.run(gateway.structured(model="text-model-test", system="sys", content="hello", name="x",
                                                       schema={"type": "object", "properties": {"a": {"type": "string"}}},
                                                       max_output_tokens=100, reasoning="low", images=[b"png"]))
    kwargs = create.await_args.kwargs
    assert kwargs["text"]["format"]["type"] == "json_schema" and kwargs["text"]["format"]["strict"] is True
    assert kwargs["store"] is False and kwargs["reasoning"] == {"effort": "low"} and "temperature" not in kwargs
    assert kwargs["input"][0]["content"][1]["image_url"].startswith("data:image/png;base64,")
    assert json.loads(text) == {"a": "b"}
    assert used == {"provider": "openai", "input_tokens": 120, "output_tokens": 40, "total_tokens": 160, "cached_input_tokens": 0, "reasoning_tokens": 12}
    assert meta["response_id"] == "resp_test" and meta["model"] == "text-model-test"


def test_refusals_and_incomplete_output_are_not_treated_as_results():
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(gateway_with(AsyncMock(return_value=text_response({}, refusal=True))).structured(
            model="m", system="s", content="c", schema={"type": "object", "properties": {}}, name="n", max_output_tokens=10))
    assert caught.value.code == "openai_refused"
    with pytest.raises(ValueError):
        asyncio.run(gateway_with(AsyncMock(return_value=text_response({"a": 1}, status="incomplete"))).structured(
            model="m", system="s", content="c", schema={"type": "object", "properties": {}}, name="n", max_output_tokens=10))


# --- provider selection ---------------------------------------------------------------------

def test_openai_selection_never_constructs_gemini_clients(monkeypatch):
    import google.genai
    monkeypatch.setattr(google.genai, "Client", lambda *a, **k: pytest.fail("Gemini client constructed while AI_PROVIDER=openai"))
    analyzer = ai_provider.create_analyzer()
    assert analyzer.provider == "openai" and ai_provider.create_image_provider().provider == "openai"
    assert ai_provider.text_model() == "text-model-test" and ai_provider.research_model() == "research-model-test"
    assert ai_provider.search_provider().__class__ is OpenAIWebSearchProvider


def test_missing_openai_key_reports_not_configured_without_gemini_fallback(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    assert ai_provider.text_configured() is False and ai_provider.image_configured() is False
    assert ai_provider.search_configured() is False
    analyzer = ai_provider.create_analyzer()  # the worker still starts; jobs fail explicitly
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(analyzer.analyze(website()))
    assert caught.value.code == "openai_not_configured"


# --- brand extraction -----------------------------------------------------------------------

def website():
    page = {"url": "https://example.com/", "title": "Example Bakery", "description": "Fresh bread daily",
            "cleaned_text": "Example Bakery bakes sourdough bread in Leeds.", "headings": [], "contacts": [],
            "social_links": {}, "structured_data": [], "style_colors": [], "contact_details": {}}
    return {"requested_url": "https://example.com/", "pages": [page], "social_links": {}}


def test_brand_extraction_uses_research_model_and_keeps_evidence_verification():
    from app.services.gemini_brand_analyzer import analysis_sources
    passages = analysis_sources(website())
    source = next(k for k, v in passages.items() if v["text"] == "Example Bakery")
    body = {"company_name": "Example Bakery", "description": None, "social_links": {"instagram": None, "facebook": None, "linkedin": None, "x": None},
            "field_evidence": [{"field": "company_name", "value": "Example Bakery", "source_id": source, "classification": "explicit", "confidence": "high"}]}
    create = AsyncMock(return_value=text_response(body))
    analyzer = ai_provider.create_analyzer(client=gateway_with(create))
    result, used = asyncio.run(analyzer.analyze(website(), lenient=True))
    assert result.company_name == "Example Bakery"
    assert result.field_evidence[0].source_url == "https://example.com/"
    assert create.await_args.kwargs["model"] == "research-model-test" and used["provider"] == "openai"


def test_brand_extraction_rejects_invented_evidence():
    body = {"company_name": "Invented Corp", "social_links": {}, "field_evidence": [
        {"field": "company_name", "value": "Invented Corp", "source_id": "S99", "classification": "explicit", "confidence": "high"}]}
    analyzer = ai_provider.create_analyzer(client=gateway_with(AsyncMock(return_value=text_response(body))))
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(analyzer.analyze(website()))
    assert caught.value.code == "invalid_ai_response"


# --- content generation ---------------------------------------------------------------------

def test_content_generation_runs_quality_pipeline_on_openai_output():
    from app.services.content_generation import generate
    context = {"company_name": "Example Bakery", "industry": "Bakery", "products_services": ["Sourdough bread", "Pastries"], "preferences": {}}
    request = {"platforms": ["LinkedIn"], "content_type": "educational", "topic": "How we bake sourdough bread", "instructions": ""}
    post = {"title": "Slow sourdough", "platform": "LinkedIn", "content_type": "educational",
            "caption": "What makes sourdough bread taste different?\n\nOur bakers in Leeds give each loaf a slow overnight rise before baking.",
            "hashtags": ["#Sourdough"], "hook": "What makes sourdough bread taste different?", "call_to_action": "Message us to reserve a loaf",
            "image_prompt": "Sourdough loaves on a floured bench", "slides": []}
    create = AsyncMock(return_value=text_response({"posts": [post]}))
    output, used = asyncio.run(generate(gateway_with(create), {"context": context, "request": request}))
    assert output["posts"][0]["caption"].startswith("What makes sourdough")
    assert output["generation_meta"]["model"] == "text-model-test" and output["generation_meta"]["provider"] == "openai"
    assert "quality" in output and used["input_tokens"] == 120
    assert create.await_args.kwargs["model"] == "text-model-test"


# --- web search -----------------------------------------------------------------------------

def search_response(text, annotations):
    note = [SimpleNamespace(type="url_citation", **a) for a in annotations]
    return SimpleNamespace(status="completed", usage=usage(),
                           output=[SimpleNamespace(type="web_search_call", action=None),
                                   SimpleNamespace(type="message", content=[SimpleNamespace(type="output_text", text=text, annotations=note)])])


def test_web_search_citations_become_clickable_markers_and_raw_links_are_removed():
    link = "([harbourroasters.co.uk](https://www.harbourroasters.co.uk/?utm_source=openai))"
    text = f"**Harbour Roasters** sells single-origin beans in Leeds {link}. More details soon."
    start = text.index(link) + 1
    response = search_response(text, [{"start_index": start, "end_index": start + len(link) - 2, "url": "https://www.harbourroasters.co.uk/?utm_source=openai", "title": "Harbour Roasters"}])
    answer = parse_response(response)
    assert answer.provider == "openai" and answer.display_only and answer.search_suggestions_html == ""
    assert "https://" not in answer.text and "(" not in answer.text
    assert answer.sources[0].uri == "https://www.harbourroasters.co.uk/?utm_source=openai"
    citation = answer.citations[0]
    assert answer.text[citation.start:citation.end].endswith("in Leeds") and citation.source_indices == [0]


def test_web_search_without_citations_is_rejected_and_not_saved():
    with pytest.raises(ExtractionError) as caught:
        parse_response(search_response("Some uncited text", []))
    assert caught.value.code == "search_missing_evidence"


def test_web_search_request_shape_and_error_mapping():
    create = AsyncMock(return_value=search_response("A ([xroast.co.uk](https://www.xroast.co.uk/))", [{"start_index": 3, "end_index": 44, "url": "https://www.xroast.co.uk/", "title": "X"}]))
    provider = OpenAIWebSearchProvider(gateway=gateway_with(create))
    asyncio.run(provider.search({"company_name": "Example"}))
    kwargs = create.await_args.kwargs
    assert kwargs["tools"] == [{"type": "web_search", "search_context_size": "medium"}]
    assert kwargs["model"] == "research-model-test" and kwargs["store"] is False
    assert provider.usage["web_search_calls"] == 1
    failing = OpenAIWebSearchProvider(gateway=gateway_with(AsyncMock(side_effect=status_error(openai.RateLimitError, 429, "insufficient_quota", "insufficient_quota"))))
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(failing.search({"company_name": "Example"}))
    assert caught.value.code == "search_rate_limited"


def test_web_search_disabled_flag_is_respected(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_WEB_SEARCH_ENABLED", False)
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(OpenAIWebSearchProvider(gateway=gateway_with(AsyncMock())).search({}))
    assert caught.value.code == "search_provider_not_configured"


# --- images ---------------------------------------------------------------------------------

def png(width, height):
    out = io.BytesIO()
    Image.new("RGB", (width, height), "sienna").save(out, "PNG")
    return out.getvalue()


def image_client(width, height, request_id="req_123"):
    def raw(**kwargs):
        response = SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png(width, height)).decode())],
                                   usage=SimpleNamespace(input_tokens=50, output_tokens=1000, total_tokens=1050,
                                                         input_tokens_details=SimpleNamespace(text_tokens=50, image_tokens=0),
                                                         output_tokens_details=None))
        return SimpleNamespace(parse=lambda: response, headers={"x-request-id": request_id})
    generate, edit = AsyncMock(side_effect=raw), AsyncMock(side_effect=raw)
    client = SimpleNamespace(images=SimpleNamespace(with_raw_response=SimpleNamespace(generate=generate, edit=edit)), close=AsyncMock())
    return client, generate, edit


@pytest.mark.parametrize("ratio", list(SIZES))
def test_every_supported_ratio_maps_to_an_exact_documented_size(ratio):
    width, height = map(int, SIZES[ratio].split("x"))
    a, b = map(int, ratio.split(":"))
    assert width % 16 == 0 and height % 16 == 0 and width * b == height * a
    assert 655_360 <= width * height <= 8_294_400 and max(width, height) <= 3840


def test_image_generation_uses_images_api_with_exact_size():
    client, generate, edit = image_client(1024, 1280)
    provider = OpenAIImageProvider(gateway=OpenAIGateway(client=client))
    raw, mime = asyncio.run(provider.generate("brief", "4:5"))
    kwargs = generate.await_args.kwargs
    assert mime == "image/png" and Image.open(io.BytesIO(raw)).size == (1024, 1280)
    assert kwargs["size"] == "1024x1280" and kwargs["model"] == "image-model-test" and kwargs["output_format"] == "png"
    assert provider.meta["response_id"] == "req_123" and provider.usage["output_tokens"] == 1000 and not edit.await_count


def test_image_edit_sends_reference_to_edits_endpoint_with_premium_model():
    client, generate, edit = image_client(1024, 1024)
    provider = OpenAIImageProvider(gateway=OpenAIGateway(client=client))
    asyncio.run(provider.generate("brief", "1:1", reference=png(512, 512)))
    kwargs = edit.await_args.kwargs
    assert kwargs["image"][0] == "reference.png" and kwargs["image"][2] == "image/png"
    assert kwargs["model"] == "premium-image-model-test" and not generate.await_count and provider.model == "premium-image-model-test"


def test_image_errors_map_to_existing_image_codes():
    client, generate, edit = image_client(1, 1)
    edit.side_effect = status_error(openai.BadRequestError, 400, "invalid_image")
    provider = OpenAIImageProvider(gateway=OpenAIGateway(client=client))
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(provider.generate("brief", "1:1", reference=png(64, 64)))
    assert caught.value.code == "image_edit_rejected"
    generate.side_effect = status_error(openai.RateLimitError, 429, "billing_hard_limit_reached")
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(provider.generate("brief", "1:1"))
    assert caught.value.code == "image_quota" and generate.await_count == 1


def test_unreadable_provider_image_is_not_saved():
    client, generate, edit = image_client(10, 10)
    generate.side_effect = lambda **kw: SimpleNamespace(parse=lambda: SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b"not an image").decode())], usage=None), headers={})
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(OpenAIImageProvider(gateway=OpenAIGateway(client=client)).generate("brief", "1:1"))
    assert caught.value.code == "image_unavailable"


# --- end to end through the API, worker handlers and PostgreSQL (OpenAI mocked) -------------

from uuid import uuid4  # noqa: E402

from sqlalchemy import select  # noqa: E402

from app.models.content import PostAsset  # noqa: E402
from app.models.intelligence import AIJob, Competitor  # noqa: E402
from app.services import ai_queue  # noqa: E402
from app.workers.intelligence import run_job  # noqa: E402
from test_onboarding import owner, workspace, company  # noqa: E402,F401
from test_post_media import setup, new_post, factory_for  # noqa: E402,F401


@pytest.fixture
def no_gemini(monkeypatch):
    import google.genai
    monkeypatch.setattr(google.genai, "Client", lambda *a, **k: pytest.fail("Gemini client constructed while AI_PROVIDER=openai"))


def run_with(db, company_id, analyzer):
    claimed = ai_queue.claim(db, company_id=company_id)
    assert claimed, "expected a queued job"
    asyncio.run(run_job(claimed, analyzer, factory_for(db)))
    db.expire_all()
    return db.get(AIJob, claimed[0])


def post_body(platform="Instagram"):
    return {"title": f"{platform} engineering ideas", "platform": platform, "content_type": "educational",
            "caption": "My Cafe brews coffee slowly so every cup tastes balanced.\n\nAsk our team how we choose each roast.",
            "hashtags": ["#Engineering"], "hook": "Our Engineering team explains careful planning", "call_to_action": "Message us with your questions",
            "image_prompt": "Engineering workbench with neat tools", "slides": []}


def test_text_job_records_openai_model_and_usage(client, db, setup, no_gemini):
    c, root = setup
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Engineering ideas"}).json()
    create = AsyncMock(return_value=text_response({"posts": [post_body()]}))
    row = run_with(db, c["id"], ai_provider.create_analyzer(client=gateway_with(create)))
    assert row.status == "completed", (row.error_code, row.error_message)
    assert row.model_identifier == "text-model-test"
    assert row.token_usage["provider"] == "openai" and row.token_usage["input_tokens"] == 120
    result = client.get(root + f"/content-generations/{job['id']}/result").json()
    assert result["posts"][0]["platform"] == "Instagram" and result["generation_meta"]["provider"] == "openai"


def test_failed_openai_text_call_never_produces_a_result(client, db, setup, no_gemini):
    c, root = setup
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Engineering ideas"}).json()
    create = AsyncMock(side_effect=status_error(openai.RateLimitError, 429, "insufficient_quota", "insufficient_quota"))
    row = run_with(db, c["id"], ai_provider.create_analyzer(client=gateway_with(create)))
    assert row.status == "failed" and row.error_code == "openai_billing_limit" and row.result is None
    assert create.await_count == 1  # billing failures are not retried
    assert client.get(root + f"/content-generations/{job['id']}/result").status_code != 200


def test_image_generation_and_reference_edit_through_worker(client, db, setup, monkeypatch, no_gemini):
    c, root = setup
    post = new_post(client, root, title="Explore Engineering ideas", image_prompt="A workshop bench")
    image_api, generate, edit = image_client(1024, 1280)
    monkeypatch.setattr(ai_provider, "create_image_provider", lambda: OpenAIImageProvider(gateway=OpenAIGateway(client=image_api)))
    assert client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "aspect_ratio": "4:5"}).status_code == 202
    row = run_with(db, c["id"], SimpleNamespace(client=None))
    assert row.status == "completed", (row.error_code, row.error_message)
    assert row.model_identifier == "image-model-test" and row.token_usage["output_tokens"] == 1000
    first = client.get(root + f"/posts/{post['id']}/assets").json()[0]
    assert (first["width"], first["height"]) == (1024, 1280) and first["generation_mode"] == "fresh"
    stored = db.get(PostAsset, first["id"])
    original_key = stored.storage_key
    assert stored.generation_model == "image-model-test" and stored.provider_request_id == "req_123"
    assert generate.await_args.kwargs["size"] == "1024x1280"
    response = client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "operation": "background", "options": {"background": "dark"}})
    assert response.status_code == 202
    run_with(db, c["id"], SimpleNamespace(client=None))
    edited = next(a for a in client.get(root + f"/posts/{post['id']}/assets").json() if a["id"] != first["id"])
    assert edited["generation_mode"] == "edit" and edited["parent_asset_id"] == first["id"]
    assert db.get(PostAsset, edited["id"]).generation_model == "premium-image-model-test"
    assert edit.await_args.kwargs["image"][1][:8] == b"\x89PNG\r\n\x1a\n"
    assert db.get(PostAsset, first["id"]).storage_key == original_key  # the original is preserved


def test_failed_openai_image_call_saves_no_asset(client, db, setup, monkeypatch, no_gemini):
    c, root = setup
    post = new_post(client, root)
    image_api, generate, _ = image_client(1024, 1024)
    generate.side_effect = status_error(openai.RateLimitError, 429, "insufficient_quota", "insufficient_quota")
    monkeypatch.setattr(ai_provider, "create_image_provider", lambda: OpenAIImageProvider(gateway=OpenAIGateway(client=image_api)))
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "aspect_ratio": "1:1"})
    row = run_with(db, c["id"], SimpleNamespace(client=None))
    assert row.status == "failed" and row.error_code == "image_quota" and generate.await_count == 1
    assert client.get(root + f"/posts/{post['id']}/assets").json() == []


def test_capabilities_report_openai(client, setup):
    c, root = setup
    caps = client.get(root + "/ai-capabilities").json()
    assert caps["ai_provider"] == "openai" and caps["ai_provider_label"] == "OpenAI" and caps["search_provider"] == "openai"
    assert caps["search_available"] and caps["image_available"] and caps["text_available"] and caps["search_mode"] == "display_only"


def test_competitor_search_is_display_only_and_imports_nothing(client, db, setup, monkeypatch, no_gemini):
    c, root = setup
    text = "Harbour Roasters ([harbourroasters.co.uk](https://www.harbourroasters.co.uk/))"
    start = text.index("[")
    response = search_response(text, [{"start_index": start, "end_index": text.rindex(")"), "url": "https://www.harbourroasters.co.uk/", "title": "Harbour Roasters"}])
    create = AsyncMock(return_value=response)
    monkeypatch.setattr(ai_provider, "search_provider", lambda: OpenAIWebSearchProvider(gateway=gateway_with(create)))
    answer = client.post(root + "/competitor-search", json={"request_key": str(uuid4())})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["provider"] == "openai" and body["display_only"] and body["sources"][0]["uri"] == "https://www.harbourroasters.co.uk/"
    assert body["text"] == "Harbour Roasters" and body["citations"][0]["source_indices"] == [0]
    journal = db.scalars(select(AIJob).where(AIJob.company_id == c["id"], AIJob.kind == "competitor_discovery")).one()
    assert journal.result == {"provider": "openai", "display_only": True} and journal.model_identifier == "research-model-test"
    assert db.scalars(select(Competitor).where(Competitor.company_id == c["id"])).all() == []


def test_stripped_bounds_are_restated_as_descriptions():
    from app.schemas.content import GeneratedContent
    wire, strict = strict_schema(GeneratedContent.model_json_schema())
    draft = wire["$defs"]["ContentDraft"]["properties"]
    assert strict and "At most 1600 characters." in draft["image_prompt"]["description"]
    assert "At most 5 items." in draft["hashtags"]["description"]
    assert "maxLength" not in draft["image_prompt"]


def test_rejected_drafts_name_fields_and_keep_usage_without_echoing_output():
    from app.services.content_generation import generate
    context = {"company_name": "Example Bakery", "industry": "Bakery", "products_services": ["Sourdough bread"], "preferences": {}}
    request = {"platforms": ["LinkedIn"], "content_type": "educational", "topic": "Sourdough bread", "instructions": ""}
    bad = {"title": "Slow sourdough", "platform": "LinkedIn", "content_type": "educational", "caption": "Example Bakery sourdough bread.",
           "hashtags": ["#Sourdough"], "hook": "Sourdough", "call_to_action": "Visit", "image_prompt": "SECRET-LONG " * 200, "slides": []}
    create = AsyncMock(return_value=text_response({"posts": [bad]}))
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(generate(gateway_with(create), {"context": context, "request": request}))
    error = caught.value
    assert error.code == "content_validation_failed" and "posts.0.image_prompt string_too_long max_length=1600" in error.message
    assert "SECRET" not in error.message and error.usage["input_tokens"] == 240
    assert "posts.0.image_prompt" in create.call_args_list[1].kwargs["input"][0]["content"][0]["text"]


def test_property_names_matching_keywords_are_kept():
    """Regression: a field named "title" was dropped with JSON-schema "title" metadata."""
    from app.schemas.content import GeneratedContent
    from app.services.gemini_brand_analyzer import GeminiAnalysis
    for model in (GeneratedContent, GeminiAnalysis):
        source = model.model_json_schema()
        wire, _ = strict_schema(source)
        for name, definition in source.get("$defs", {}).items():
            if "properties" in definition:
                assert set(wire["$defs"][name]["properties"]) == set(definition["properties"]), name
                assert wire["$defs"][name]["required"] == list(definition["properties"])
    assert "title" in strict_schema(GeneratedContent.model_json_schema())[0]["$defs"]["ContentDraft"]["required"]
