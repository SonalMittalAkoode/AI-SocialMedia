"""Phase 8A.1: structured image briefs, creative controls, variations, quality checks,
manual review and caption strategy. Gemini calls are mocked; PostgreSQL and storage are real."""
import asyncio
import io
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError
from google.genai import errors
from app.core.intelligence_config import ai_settings
from app.core.security import create_access_token
from app.models.content import PostAsset
from app.models.intelligence import AIJob
from app.models.onboarding import WorkspaceMember
from app.models.user import User
from app.schemas.content import ContentDraft, GeneratedContent, GenerationRequest, ImageOptions, ImageRequest
from app.services import ai_queue, image_prompt, image_quality, media_storage
from app.services.content_generation import strategy, quality_report, generate, context_for, cliches_in
from app.services.media_storage import GoogleImageProvider
from app.services.extraction_jobs import now
from test_onboarding import owner, workspace, company  # noqa: F401
from test_content import draft
from test_post_media import setup, run_next, new_post, generated  # noqa: F401
from test_scheduling_api import body as schedule_body


def picture(size=(800, 1000), color=(49, 91, 214), accent=(255, 255, 255), seed=0):
    image = Image.new("RGB", size, color)
    shape = ImageDraw.Draw(image)
    shape.ellipse([size[0] // 4 + seed * 40, size[1] // 4, size[0] // 2 + seed * 40, size[1] // 2], fill=accent)
    shape.rectangle([10, size[1] - 120 - seed * 30, size[0] // 3, size[1] - 20], fill=(20, 20, 20))
    data = io.BytesIO(); image.save(data, format="PNG"); return data.getvalue()


TECH = {"company_name": "Akoode", "industry": "AI & Software Development", "products_services": ["Custom AI solutions", "Mobile app development"],
        "target_audience": "Business technology leaders", "brand_voice": ["Expert", "Clear"], "brand_colors": ["#ffffff", "#315bd6"],
        "preferences": {"visual_style": "Abstract geometric blue and white illustrations", "excluded_topics": ["Discounts"]}}
CAFE = {"company_name": "Brew & Bean", "industry": "Food & Beverage", "products_services": ["Specialty coffee", "Fresh pastries"],
        "brand_colors": ["#795038", "#f5ead8"], "preferences": {}}
CLINIC = {"company_name": "Calm Dental", "industry": "Dental clinic", "products_services": ["Teeth cleaning", "Orthodontics"],
          "brand_colors": ["#2e7d32", "#3b8f3f"], "preferences": {}}


# ---------- prompt architecture ----------

def test_structured_brief_sections_industries_and_bounds():
    post = {"platform": "Instagram", "content_type": "educational", "title": "How a mobile app reduces manual work", "image_prompt": "A field technician using a tablet app"}
    prompt, meta = image_prompt.build_brief(TECH, post, "4:5")
    order = [prompt.index(f"{n}. ") for n in range(1, 10)]
    assert order == sorted(order) and len(prompt) <= image_prompt.MAX_BRIEF_CHARS
    # "Auto" follows the brand's saved preference ("...illustrations") rather than a conflicting industry default.
    assert meta["industry_category"] == "technology" and meta["style"] == "modern_illustration" and meta["style_source"] == "saved_preference"
    no_pref = image_prompt.build_brief({**TECH, "preferences": {}}, post, "4:5")[1]
    assert no_pref["style"] == "editorial" and no_pref["style_source"] == "recommended"
    assert image_prompt.style_from_preference("Warm photographic flat-lays") == "photorealistic" and image_prompt.style_from_preference("brand blue") is None
    assert meta["offering"] == "Mobile app development"  # the offering that matches the topic, not all four
    assert "glowing brains" in prompt and "deep" not in meta["palette_names"][1] and "blue (#315bd6)" in prompt
    assert "Saved brand visual preference" in prompt and "Discounts" in prompt and "No rendered text" in prompt
    assert image_prompt.build_brief(CAFE, post, "1:1")[1]["industry_category"] == "food"
    clinic_prompt, clinic = image_prompt.build_brief(CLINIC, post, "9:16")
    assert clinic["industry_category"] == "healthcare" and "identifiable patients" in clinic_prompt
    assert clinic["palette_narrow"] and "complementary colors" in clinic_prompt and "central safe zone" in clinic_prompt
    hexed = image_prompt.build_brief(TECH, {**post, "image_prompt": "A tablet in #315bd6 and #ffffff tones"}, "1:1")[0]
    assert "A tablet in blue and white tones" in hexed and "stays blank" in hexed
    long = image_prompt.build_brief(TECH, {**post, "image_prompt": "x " * 3000}, "1:1", None, "y " * 400)[0]
    assert len(long) <= image_prompt.MAX_BRIEF_CHARS and "9. Restrictions" in long


def test_explicit_style_and_controls_replace_defaults_without_contradiction():
    post = {"platform": "LinkedIn", "content_type": "promotional", "title": "Pastry box", "image_prompt": "A pastry box"}
    prompt, meta = image_prompt.build_brief(TECH, post, "1:1", {"visual_style": "cinematic", "background": "dark", "negative_space": "generous",
                                                               "detail_level": "minimal", "color_intensity": "vibrant", "negative_instructions": "smoke"})
    assert meta["style"] == "cinematic" and meta["style_source"] == "selected"
    assert "Saved brand visual preference" not in prompt  # explicit choice replaces the saved preference
    for expected in ("Cinematic", "dark, low-key background", "generous clean negative space", "at most three elements", "boldly and saturated", "Also avoid: smoke", "Product/service promotion"):
        assert expected in prompt
    custom = image_prompt.build_brief(TECH, post, "1:1", {"visual_style": "custom", "custom_style": "risograph print"})[0]
    assert "Custom style: risograph print" in custom
    text_prompt, text_meta = image_prompt.build_brief(TECH, post, "1:1", {"text_in_image": True, "overlay_text": "Build smarter apps"})
    assert text_meta["text_in_image"] and '"Build smarter apps"' in text_prompt and "No rendered text" not in text_prompt


def test_image_options_validation():
    for bad in ({"visual_style": "custom"}, {"text_in_image": True}, {"text_in_image": True, "overlay_text": "one two three four five six seven"},
                {"overlay_text": "Hello"}, {"text_in_image": True, "overlay_text": "visit www.example.com"}, {"visual_style": "neon"}):
        with pytest.raises(ValidationError):
            ImageOptions(**bad)
    for bad in ({"operation": "custom"}, {"operation": "style"}, {"operation": "platform"}, {"operation": "background", "options": {"background": "auto"}}):
        with pytest.raises(ValidationError):
            ImageRequest(request_key=uuid4(), **bad)
    with pytest.raises(ValidationError, match="evidence"):
        GenerationRequest(request_key=uuid4(), platforms=["LinkedIn"], topic="Project", objective="case_study")


def test_color_names_and_palette_contrast():
    assert image_prompt.color_name("#929c87") == "sage grey" and image_prompt.color_name("#3b2417") == "deep brown"
    assert image_prompt.color_name("#ff2dab") == "vivid magenta" and image_prompt.color_name("#ffffff") == "white"
    assert image_prompt.palette({"brand_colors": ["#929c87", "#7f8975", "bad", "#929C87"]})["colors"] == ["#929c87", "#7f8975"]
    assert image_prompt.palette({"brand_colors": ["#000000", "#ffffff"]})["narrow"] is False


# ---------- deterministic quality ----------

def test_quality_checks_ratio_blank_duplicate_palette_and_text():
    good = picture((800, 1000))
    report, phash = image_quality.evaluate(good, "image/png", "4:5", ["#315bd6", "#ff2dab"])
    assert report["status"] == "ready_for_review" and phash
    statuses = {c["id"]: c["status"] for c in report["checks"]}
    assert statuses == {"file": "pass", "resolution": "pass", "aspect_ratio": "pass", "content": "pass", "brand_colors": "pass"}
    assert report["palette_share"]["#315bd6"] > 0.3 and report["palette_share"]["#ff2dab"] == 0
    mismatch, _ = image_quality.evaluate(picture((1000, 1000)), "image/png", "4:5")
    assert mismatch["status"] == "needs_review" and "not stretched" in next(c for c in mismatch["checks"] if c["id"] == "aspect_ratio")["detail"]
    blank_data = io.BytesIO(); Image.new("RGB", (800, 800), "white").save(blank_data, format="PNG")
    blank, _ = image_quality.evaluate(blank_data.getvalue(), "image/png", "1:1")
    assert blank["status"] == "needs_review"
    duplicate, _ = image_quality.evaluate(good, "image/png", "4:5", (), [phash])
    assert next(c for c in duplicate["checks"] if c["id"] == "duplicate")["status"] == "fail"
    edited, _ = image_quality.evaluate(good, "image/png", "4:5", (), [hex(int(phash, 16) ^ 0b111)[2:].zfill(16)], edit=True)
    assert next(c for c in edited["checks"] if c["id"] == "duplicate")["status"] == "pass"  # similar is expected for an edit
    unchanged, _ = image_quality.evaluate(good, "image/png", "4:5", (), [phash], edit=True)
    assert "little visible change" in next(c for c in unchanged["checks"] if c["id"] == "duplicate")["detail"]
    different, _ = image_quality.evaluate(picture((800, 1000), (240, 200, 40), (10, 10, 10), seed=3), "image/png", "4:5", (), [phash])
    assert next(c for c in different["checks"] if c["id"] == "duplicate")["status"] == "pass"
    text, _ = image_quality.evaluate(good, "image/png", "4:5", (), (), text_expected=True)
    assert text["status"] == "needs_review" and any(c["id"] == "rendered_text" for c in text["checks"])
    broken, digest = image_quality.evaluate(b"not an image", "image/png", "1:1")
    assert broken["status"] == "needs_review" and digest is None


def test_ai_review_is_an_opinion_and_failure_never_blocks():
    review = {"subject_alignment": "strong", "subject_summary": "A tablet", "visible_text": "AI", "text_matches_request": False,
              "artifacts": [], "brand_suitability": "suitable", "composition_note": "Clear"}
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock(return_value=SimpleNamespace(text=json.dumps(review), usage_metadata=None)))))
    result, _, error = asyncio.run(image_quality.ai_review(client, "review-model", picture(), "brief"))
    assert error is None
    base = {"status": "ready_for_review", "checks": [], "ai_review": None}
    merged = image_quality.merge_review(base, result)
    assert merged["status"] == "needs_review" and "unexpected text" in merged["checks"][0]["detail"] and "not an objective score" in merged["checks"][0]["detail"]
    failing = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock(side_effect=errors.APIError(503, {"error": {"message": "busy"}})))))
    result, _, error = asyncio.run(image_quality.ai_review(failing, "review-model", picture(), "brief"))
    unavailable = image_quality.merge_review(base, result, error=error)
    assert error == "review_unavailable" and unavailable["status"] == "ready_for_review" and unavailable["ai_review"]["status"] == "unavailable"


# ---------- worker, variations and provenance ----------

def test_generated_image_records_provenance_quality_and_actual_dimensions(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root, title="Explore Engineering ideas", image_prompt="A workshop bench")
    # The provider ignores the requested 4:5 and returns a square image: it is stored as-is and flagged.
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(return_value=(picture((900, 900)), "image/png")))
    assert client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "aspect_ratio": "4:5", "options": {"visual_style": "editorial"}}).status_code == 202
    job_id = run_next(db, c["id"])
    asset = client.get(root + f"/posts/{post['id']}/assets").json()[0]
    assert (asset["width"], asset["height"], asset["mime_type"]) == (900, 900, "image/png")
    assert asset["quality_status"] == "needs_review" and asset["prompt_version"] == image_prompt.PROMPT_VERSION
    assert asset["generation_mode"] == "fresh" and asset["operation"] == "same_brief" and asset["style"] == "editorial"
    assert asset["duration_ms"] is not None and asset["quality_report"]["ai_review"]["status"] == "disabled"
    assert db.get(AIJob, job_id).result["quality_status"] == "needs_review"


def test_edit_variation_sends_previous_image_and_keeps_history(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    provider = AsyncMock(side_effect=[(picture(seed=0), "image/png"), (picture((800, 1000), (200, 80, 40), seed=2), "image/png"), (picture((720, 1280), seed=1), "image/png")])
    monkeypatch.setattr(GoogleImageProvider, "generate", provider)
    assert client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "operation": "refine", "instructions": "warmer"}).status_code == 422
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "aspect_ratio": "4:5"}); run_next(db, c["id"])
    first = client.get(root + f"/posts/{post['id']}/assets").json()[0]
    response = client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "operation": "background", "options": {"background": "dark"}})
    assert response.status_code == 202
    payload = db.get(AIJob, response.json()["id"]).payload
    assert payload["mode"] == "edit" and payload["parent_asset_id"] == first["id"] and "dark, low-key background" in payload["edit_instruction"]
    assert payload["aspect_ratio"] == "4:5"  # inherited from the source image
    run_next(db, c["id"])
    assert provider.call_args_list[1].kwargs["reference"][:8] == b"\x89PNG\r\n\x1a\n"
    assets = client.get(root + f"/posts/{post['id']}/assets").json()
    edited = next(a for a in assets if a["id"] != first["id"])
    assert edited["is_primary"] and edited["parent_asset_id"] == first["id"] and edited["generation_mode"] == "edit" and edited["options"]["background"] == "dark"
    # Another platform format is a fresh composition at the new ratio, never a stretched copy.
    response = client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "operation": "platform", "aspect_ratio": "9:16"})
    payload = db.get(AIJob, response.json()["id"]).payload
    assert payload["mode"] == "fresh" and payload["aspect_ratio"] == "9:16" and "edit_instruction" not in payload
    assert payload["brief"]["options"]["background"] == "dark"  # unchanged choices carry over
    run_next(db, c["id"])
    assert "reference" not in provider.call_args_list[2].kwargs
    assert len(client.get(root + f"/posts/{post['id']}/assets").json()) == 3


def test_edit_falls_back_to_fresh_generation_when_source_file_is_missing(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    provider = AsyncMock(side_effect=[(picture(seed=0), "image/png"), (picture(seed=2), "image/png")])
    monkeypatch.setattr(GoogleImageProvider, "generate", provider)
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())}); run_next(db, c["id"])
    first = db.get(PostAsset, client.get(root + f"/posts/{post['id']}/assets").json()[0]["id"])
    media_storage.LocalMediaStorage().remove(first.storage_key)
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "operation": "simplify"})
    job_id = run_next(db, c["id"])
    result = db.get(AIJob, job_id).result
    assert result["mode"] == "fresh" and "unavailable" in result["notes"][0]
    assert "reference" not in provider.call_args_list[1].kwargs


def test_variation_on_approved_scheduled_post_requires_reapproval(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(side_effect=[(picture(seed=0), "image/png"), (picture(seed=3), "image/png")]))
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())}); run_next(db, c["id"])
    post = client.get(root + f"/posts/{post['id']}").json()
    post = client.post(root + f"/posts/{post['id']}/approve", json={"revision": post["revision"]}).json()
    schedule = client.post(root + "/schedules", json=schedule_body(post)).json()
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "operation": "alternative"}); run_next(db, c["id"])
    after = client.get(root + f"/posts/{post['id']}").json()
    assert after["status"] == "draft" and client.get(root + f"/schedules/{schedule['id']}").json()["status"] == "blocked"


def test_overlay_text_claims_are_rejected(client, setup):
    _, root = setup
    post = new_post(client, root)
    for text in ("Award-winning coffee", "Save 50% today"):
        response = client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "options": {"text_in_image": True, "overlay_text": text}})
        assert response.status_code == 422, text


def test_text_with_images_carries_image_options_and_objective(client, db, setup, monkeypatch):
    c, root = setup
    monkeypatch.setattr("app.services.content_handlers.generate", AsyncMock(return_value=generated(["Instagram"])))
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Launch", "objective": "promotion",
                                                           "include_images": True, "image_options": {"visual_style": "lifestyle", "text_in_image": True, "overlay_text": "Award-winning"}})
    assert job.status_code == 202, job.text
    run_next(db, c["id"])
    image = db.query(AIJob).filter(AIJob.company_id == c["id"], AIJob.kind == "image_generation").one()
    assert image.payload["brief"]["style"] == "lifestyle" and image.payload["brief"]["objective"] == "promotion"
    assert image.payload["brief"]["text_in_image"] is False  # unsupported image text falls back to no text, text job unaffected


# ---------- manual review ----------

def test_accept_reject_review_and_approval_guard(client, db, owner, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(return_value=(picture(), "image/png")))
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())}); run_next(db, c["id"])
    asset = client.get(root + f"/posts/{post['id']}/assets").json()[0]
    rejected = client.post(root + f"/media/{asset['id']}/review", json={"decision": "rejected"}).json()
    assert rejected["review_decision"] == "rejected" and rejected["reviewed_at"] and rejected["is_primary"]
    current = client.get(root + f"/posts/{post['id']}").json()
    assert client.post(root + f"/posts/{post['id']}/approve", json={"revision": current["revision"]}).status_code == 422
    assert client.get(root + f"/posts/{post['id']}").json()["revision"] == current["revision"]  # review is not a content change
    assert client.post(root + f"/media/{asset['id']}/review", json={"decision": "accepted"}).json()["review_decision"] == "accepted"
    assert client.post(root + f"/posts/{post['id']}/approve", json={"revision": current["revision"]}).status_code == 200
    cleared = client.post(root + f"/media/{asset['id']}/review", json={"decision": None}).json()
    assert cleared["review_decision"] is None and cleared["reviewed_at"] is None
    assert len(client.get(root + f"/posts/{post['id']}/assets").json()) == 1  # nothing deleted
    member = User(full_name="Member", email=f"member-{uuid4().hex}@example.com", hashed_password=owner.hashed_password)
    db.add(member); db.flush()
    db.add(WorkspaceMember(workspace_id=c["workspace_id"], user_id=member.id, role="member")); db.commit()
    client.cookies.set("access_token", create_access_token(member.id))
    assert client.post(root + f"/media/{asset['id']}/review", json={"decision": "rejected"}).status_code == 403
    stranger = User(full_name="Stranger", email=f"stranger-{uuid4().hex}@example.com", hashed_password=owner.hashed_password)
    db.add(stranger); db.commit(); client.cookies.set("access_token", create_access_token(stranger.id))
    assert client.post(root + f"/media/{asset['id']}/review", json={"decision": "rejected"}).status_code == 404


def test_capabilities_expose_industry_styles(client, setup):
    _, root = setup
    capabilities = client.get(root + "/ai-capabilities").json()
    assert capabilities["image_prompt_version"] == image_prompt.PROMPT_VERSION
    assert capabilities["recommended_styles"] and {"id": "custom", "label": "Custom"} in capabilities["visual_styles"]


# ---------- captions ----------

def test_strategy_objectives_platforms_audience_and_evidence():
    context = {"company_name": "Akoode", "industry": "Software", "products_services": ["Custom AI solutions"], "preferences": {"goals": ["Lead generation"], "tones": ["Warm"]},
               "recent_posts": [{"platform": "LinkedIn", "title": "Old", "opening": "Old opening"}]}
    request = {"topic": "Workflow automation", "platforms": ["LinkedIn", "Instagram"], "content_type": "text"}
    plan = strategy(context, request)
    assert plan["objective"] == "promotion" and set(plan["platform_conventions"]) == {"LinkedIn", "Instagram"}
    assert plan["recent_posts_to_avoid"][0]["opening"] == "Old opening" and plan["prompt_version"] == "caption-v2.2"
    plan = strategy(context, {**request, "objective": "case_study", "audience": "Operations managers", "tone": "Direct", "evidence": "Cut onboarding from 9 days to 3 days for a logistics client."})
    assert plan["objective"] == "case_study" and plan["audience"] == "Operations managers" and plan["tone"] == ["Direct"] and "9 days" in plan["supplied_evidence"]
    assert strategy({**context, "preferences": {}}, {**request, "content_type": "educational"})["objective"] == "educational"
    from app.services.content_generation import validate_quality
    caption = "Akoode cut onboarding from 9 days to 3 days using Custom AI solutions."
    post = GeneratedContent(posts=[ContentDraft(**draft(platform="LinkedIn", caption=caption))])
    with pytest.raises(ValueError, match="numeric"):
        validate_quality(post, context, {**request, "platforms": ["LinkedIn"]})
    assert validate_quality(post, context, {**request, "platforms": ["LinkedIn"], "evidence": "Cut onboarding from 9 days to 3 days."})


def test_quality_report_flags_generic_repetitive_and_platform_issues():
    context = {"company_name": "Akoode", "industry": "Software", "products_services": ["Custom AI solutions"], "preferences": {},
               "recent_posts": [{"platform": "LinkedIn", "title": "Earlier", "opening": "Our custom AI solutions help operations teams remove repetitive data entry from daily work"}]}
    request = {"topic": "data entry", "platforms": ["LinkedIn"], "content_type": "educational"}
    generic = "Unlock seamless growth and elevate your business in today's fast-paced world with Akoode custom AI solutions. " * 2
    report = quality_report(GeneratedContent(posts=[ContentDraft(**draft(platform="LinkedIn", caption=generic, hashtags=[]))]), context, request)[0]
    checks = {c["id"]: c for c in report["checks"]}
    assert checks["voice"]["status"] == "warn" and "unlock" in checks["voice"]["detail"]
    assert checks["platform"]["status"] == "warn" and "hashtags" in checks["platform"]["detail"]
    repeated = "Our custom AI solutions help operations teams remove repetitive data entry from daily work, so people focus on exceptions."
    report = quality_report(GeneratedContent(posts=[ContentDraft(**draft(platform="LinkedIn", caption=repeated))]), context, request)[0]
    assert {c["id"]: c["status"] for c in report["checks"]}["repetition"] == "warn"
    assert cliches_in("Elevate your morning", {"description": "We elevate everyday coffee"}) == []  # the brand's own vocabulary is respected


def test_generic_copy_gets_one_rewrite_and_valid_first_draft_is_kept():
    context = {"company_name": "Akoode", "industry": "Software", "products_services": ["Custom AI solutions"], "preferences": {}}
    request = {"topic": "AI", "platforms": ["Instagram"], "content_type": "text"}
    generic = draft(caption="Unlock and elevate your seamless workflow with Akoode custom AI solutions.")
    specific = draft(caption="Akoode builds custom AI solutions that sort incoming support tickets before your team starts the day.")
    responses = [SimpleNamespace(text=json.dumps({"posts": [generic]}), usage_metadata=None, response_id="resp-1", model_version="m-1"),
                 SimpleNamespace(text=json.dumps({"posts": [specific]}), usage_metadata=None, response_id="resp-2", model_version="m-1")]
    mock = AsyncMock(side_effect=responses)
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock)))
    result, _ = asyncio.run(generate(client, {"context": context, "request": request}))
    assert mock.await_count == 2 and "generic marketing filler" in mock.call_args_list[1].kwargs["contents"]
    assert result["posts"][0]["caption"] == specific["caption"]
    assert result["generation_meta"]["response_id"] == "resp-2" and result["generation_meta"]["attempts"] == 2 and result["quality"]
    invalid = SimpleNamespace(text="{}", usage_metadata=None)
    mock = AsyncMock(side_effect=[responses[0], invalid])
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock)))
    result, _ = asyncio.run(generate(client, {"context": context, "request": request}))
    assert result["posts"][0]["caption"] == generic["caption"]  # never lose a valid draft to a failed rewrite
    assert {c["id"]: c["status"] for c in result["quality"][0]["checks"]}["voice"] == "warn"


def test_result_caption_regeneration_and_recent_post_context(client, db, setup, monkeypatch):
    c, root = setup
    new_post(client, root, title="Earlier post", hook="An earlier opening")
    monkeypatch.setattr("app.services.content_handlers.generate", AsyncMock(return_value=generated(["Instagram"])))
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Launch", "objective": "engagement", "audience": "Office managers"}).json()
    run_next(db, c["id"])
    assert client.post(root + f"/content-generations/{job['id']}/results/3/caption", json={"request_key": str(uuid4())}).status_code == 422
    response = client.post(root + f"/content-generations/{job['id']}/results/0/caption", json={"request_key": str(uuid4()), "mode": "caption"})
    assert response.status_code == 202
    request = db.get(AIJob, response.json()["id"]).payload["request"]
    assert request["regenerate_mode"] == "caption" and request["objective"] == "engagement" and request["audience"] == "Office managers"
    assert "include_images" not in request and "Explore Engineering ideas on Instagram" in request["instructions"]
    from app.models.onboarding import Company
    context = context_for(db, db.get(Company, c["id"]))
    assert context["recent_posts"][0]["opening"] == "An earlier opening" and len(context["recent_posts"]) <= 6


# ---------- provider and queue ----------

def test_provider_caches_model_check_sends_reference_and_maps_edit_rejection(monkeypatch):
    monkeypatch.setattr(ai_settings, "gemini_image_model", "cache-test-model")
    media_storage._MODEL_CHECK.clear()
    image_part = SimpleNamespace(inline_data=SimpleNamespace(data=picture(), mime_type="image/png"))
    response = SimpleNamespace(usage_metadata=None, response_id="img-1", model_version="v1", candidates=[SimpleNamespace(content=SimpleNamespace(parts=[image_part]))])
    models = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(supported_actions=["generateContent"])), generate_content=AsyncMock(return_value=response))
    provider = GoogleImageProvider(SimpleNamespace(aio=SimpleNamespace(models=models)))
    asyncio.run(provider.generate("brief", "1:1")); asyncio.run(provider.generate("brief", "1:1", reference=picture()))
    assert models.get.await_count == 1 and provider.meta == {"response_id": "img-1", "model_version": "v1"}
    contents = models.generate_content.call_args_list[1].kwargs["contents"]
    assert isinstance(contents, list) and contents[1] == "brief"
    models.generate_content = AsyncMock(side_effect=errors.APIError(400, {"error": {"message": "bad"}}))
    from app.services.extraction_errors import ExtractionError
    with pytest.raises(ExtractionError) as error:
        asyncio.run(provider.generate("brief", "1:1", reference=picture()))
    assert error.value.code == "image_edit_rejected" and not error.value.transient


def test_transient_failures_back_off_exponentially(client, db, setup):
    c, root = setup
    post = new_post(client, root)
    job = client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())}).json()
    from app.services.extraction_errors import ExtractionError
    claimed = ai_queue.claim(db, company_id=c["id"])
    before = now()
    ai_queue.fail(db, claimed[0], claimed[1], ExtractionError("image_timeout", "timed out", True))
    row = db.get(AIJob, job["id"])
    assert row.status == "queued" and timedelta(seconds=4) <= row.available_at - before <= timedelta(seconds=7)
