"""Text-with-image generation, uploads, primary image, revision protection, versions.

Gemini text/image calls are mocked; PostgreSQL and private storage are real (tmp root).
"""
import asyncio
import io
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
import pytest
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from google.genai import errors
from app.core.intelligence_config import ai_settings
from app.core.security import create_access_token
from app.models.content import PostAsset, PostVersion
from app.models.intelligence import AIJob
from app.models.user import User
from app.services import ai_queue, post_media
from app.services.media_storage import GoogleImageProvider
from app.services.extraction_errors import ExtractionError
from app.workers.intelligence import run_job
from test_onboarding import owner, workspace, company  # noqa: F401
from test_content import draft
from test_scheduling_api import body as schedule_body


def png(color="pink", size=(160, 200), fmt="PNG"):
    data = io.BytesIO(); Image.new("RGB", size, color).save(data, format=fmt); return data.getvalue()


@pytest.fixture
def setup(client, owner, monkeypatch, tmp_path):
    monkeypatch.setattr(ai_settings, "gemini_image_model", "test-image-model")
    monkeypatch.setattr(ai_settings, "media_root", tmp_path)
    c = company(client, workspace(client)["id"]); root = f"/api/v1/companies/{c['id']}"
    client.post(root + "/brand/confirm", json={"revision": 1})
    return c, root


def factory_for(db):
    @contextmanager
    def factory():
        yield db
    return factory


def run_next(db, company_id):
    claimed = ai_queue.claim(db, company_id=company_id)
    assert claimed, "expected a queued job"
    asyncio.run(run_job(claimed, SimpleNamespace(client=None), factory_for(db)))
    return claimed[0]


def generated(platforms):
    posts = [draft(platform=p, title=f"{p} launch", caption=f"Explore Engineering ideas on {p}", image_prompt="Abstract gears in brand colors") for p in platforms]
    return {"posts": posts, "strategy": {}, "warnings": ["Human review required"]}, {"total_token_count": 10}


def new_post(client, root, **changes):
    response = client.post(root + "/posts", json=draft(creation_key=str(uuid4()), **changes))
    assert response.status_code == 201, response.text
    return response.json()


# ---------- text with image ----------

def test_text_with_images_queues_one_image_per_result_and_links_on_save(client, db, setup, monkeypatch):
    c, root = setup
    monkeypatch.setattr("app.services.content_handlers.generate", AsyncMock(return_value=generated(["Instagram", "X"])))
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram", "X"], "topic": "Launch", "include_images": True, "aspect_ratios": {"X": "16:9"}}).json()
    run_next(db, c["id"])
    result = client.get(root + f"/content-generations/{job['id']}/result").json()
    assert [i["aspect_ratio"] for i in result["image_jobs"]] == ["4:5", "16:9"]  # Instagram default, X requested
    image_jobs = db.scalars(select(AIJob).where(AIJob.company_id == c["id"], AIJob.kind == "image_generation").order_by(AIJob.target_key)).all()
    assert [j.target_key for j in image_jobs] == [f"{job['id']}:0", f"{job['id']}:1"]  # concurrent targets allowed
    assert "Instagram" in image_jobs[0].payload["prompt"] and "aspect ratio 4:5" in image_jobs[0].payload["prompt"]
    assert "Abstract gears in brand colors" in image_jobs[1].payload["prompt"]
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(return_value=(png(), "image/png")))
    run_next(db, c["id"]); run_next(db, c["id"])
    media = client.get(root + f"/content-generations/{job['id']}/media").json()
    assert len(media["assets"]) == 2 and all(a["post_id"] is None for a in media["assets"])
    assert {j["status"] for j in media["jobs"]} == {"completed"}
    saved = client.post(root + "/posts", json={**result["posts"][0], "creation_key": str(uuid4()), "generation_job_id": job["id"], "result_index": 0}).json()
    assets = client.get(root + f"/posts/{saved['id']}/assets").json()
    assert len(assets) == 1 and assets[0]["is_primary"] and assets[0]["source"] == "generated"
    assert saved["primary_asset_id"] == assets[0]["id"]


def test_image_failure_never_affects_text(client, db, setup, monkeypatch):
    c, root = setup
    monkeypatch.setattr("app.services.content_handlers.generate", AsyncMock(return_value=generated(["LinkedIn"])))
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["LinkedIn"], "topic": "Launch", "include_images": True}).json()
    run_next(db, c["id"])
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(side_effect=ExtractionError("image_quota", "Quota exhausted")))
    image_job = run_next(db, c["id"])
    assert db.get(AIJob, image_job).status == "failed" and db.get(AIJob, image_job).error_code == "image_quota"
    assert client.get(root + f"/content-generations/{job['id']}").json()["status"] == "completed"
    result = client.get(root + f"/content-generations/{job['id']}/result").json()
    saved = client.post(root + "/posts", json={**result["posts"][0], "creation_key": str(uuid4()), "generation_job_id": job["id"], "result_index": 0})
    assert saved.status_code == 201 and saved.json()["primary_asset_id"] is None
    # Regenerate the image for that result explicitly later.
    retry = client.post(root + f"/content-generations/{job['id']}/results/0/images", json={"request_key": str(uuid4()), "aspect_ratio": "1:1"})
    assert retry.status_code == 202


def test_text_with_images_reserves_capacity(client, db, setup, monkeypatch):
    _, root = setup
    monkeypatch.setattr(ai_settings, "hourly_company_limit", 2)
    denied = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram", "X"], "topic": "Launch", "include_images": True})
    assert denied.status_code == 429
    allowed = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Launch", "include_images": True})
    assert allowed.status_code == 202


def test_text_only_when_no_image_model(client, db, setup, monkeypatch):
    c, root = setup
    monkeypatch.setattr(ai_settings, "gemini_image_model", None)
    monkeypatch.setattr("app.services.content_handlers.generate", AsyncMock(return_value=generated(["Instagram"])))
    job = client.post(root + "/content-generations", json={"request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Launch", "include_images": True}).json()
    run_next(db, c["id"])
    result = client.get(root + f"/content-generations/{job['id']}/result").json()
    assert "image_jobs" not in result and any("no image model" in w for w in result["warnings"])


# ---------- post images and revision protection ----------

def test_image_on_approved_scheduled_post_returns_it_to_draft_and_blocks_schedule(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    post = client.post(root + f"/posts/{post['id']}/approve", json={"revision": post["revision"]}).json()
    schedule = client.post(root + "/schedules", json=schedule_body(post))
    assert schedule.status_code == 201, schedule.text
    assert client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4()), "aspect_ratio": "7:3"}).status_code == 422
    assert client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())}).status_code == 202
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(return_value=(png(), "image/png")))
    run_next(db, c["id"])
    after = client.get(root + f"/posts/{post['id']}").json()
    assert after["status"] == "draft" and after["revision"] > post["revision"] and after["primary_asset_id"]
    assert client.get(root + f"/schedules/{schedule.json()['id']}").json()["status"] == "blocked"


def test_image_generated_after_edit_is_kept_as_alternative(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())})
    edited = client.patch(root + f"/posts/{post['id']}", json={**draft(caption="Edited Engineering caption"), "revision": post["revision"], "status": "draft"}).json()
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(return_value=(png(), "image/png")))
    job_id = run_next(db, c["id"])
    assert db.get(AIJob, job_id).result["primary"] is False
    assets = client.get(root + f"/posts/{post['id']}/assets").json()
    assert len(assets) == 1 and not assets[0]["is_primary"]
    assert client.get(root + f"/posts/{post['id']}").json()["revision"] == edited["revision"]


def test_regenerating_image_keeps_previous_images(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    monkeypatch.setattr(GoogleImageProvider, "generate", AsyncMock(side_effect=[(png("pink"), "image/png"), (png("green"), "image/png")]))
    for _ in range(2):
        current = client.get(root + f"/posts/{post['id']}").json()
        client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())})
        run_next(db, c["id"])
    assets = client.get(root + f"/posts/{post['id']}/assets").json()
    assert len(assets) == 2 and [a["is_primary"] for a in assets] == [True, False]
    assert current["revision"] < client.get(root + f"/posts/{post['id']}").json()["revision"]


def test_primary_selection_is_revision_protected(client, db, setup):
    c, root = setup
    post = new_post(client, root)
    first = client.post(root + f"/posts/{post['id']}/assets/upload?revision={post['revision']}", content=png("red"), headers={"Content-Type": "image/png"}).json()
    post = first["post"]
    second = client.post(root + f"/posts/{post['id']}/assets/upload?revision={post['revision']}", content=png("blue"), headers={"Content-Type": "image/png"}).json()
    post = client.post(root + f"/posts/{post['id']}/approve", json={"revision": second["post"]["revision"]}).json()
    url = root + f"/posts/{post['id']}/primary-asset"
    assert client.put(url, json={"revision": post["revision"] - 1, "asset_id": first["asset"]["id"]}).status_code == 409
    assert client.put(url, json={"revision": post["revision"], "asset_id": str(uuid4())}).status_code == 404
    switched = client.put(url, json={"revision": post["revision"], "asset_id": first["asset"]["id"]})
    assert switched.status_code == 200 and switched.json()["status"] == "draft" and switched.json()["primary_asset_id"] == first["asset"]["id"]
    cleared = client.put(url, json={"revision": switched.json()["revision"], "asset_id": None}).json()
    assert cleared["primary_asset_id"] is None
    assert len(client.get(root + f"/posts/{post['id']}/assets").json()) == 2  # nothing deleted


# ---------- uploads ----------

def test_upload_validation_storage_download_and_isolation(client, db, owner, setup):
    c, root = setup
    post = new_post(client, root)
    upload = root + f"/posts/{post['id']}/assets/upload?revision={post['revision']}"
    assert client.post(upload, content=b"<svg/>", headers={"Content-Type": "image/svg+xml"}).status_code == 415
    assert client.post(upload, content=b"not an image", headers={"Content-Type": "image/png"}).status_code == 422
    assert client.post(upload, content=png(fmt="PNG"), headers={"Content-Type": "image/jpeg"}).status_code == 422
    assert client.post(root + f"/posts/{post['id']}/assets/upload?revision=99", content=png(), headers={"Content-Type": "image/png"}).status_code == 409
    webp = client.post(upload + "&filename=../../evil%20name.webp", content=png(fmt="WEBP", size=(400, 500)), headers={"Content-Type": "image/webp"})
    assert webp.status_code == 201, webp.text
    asset = webp.json()["asset"]
    assert asset["mime_type"] == "image/png" and asset["source"] == "uploaded" and asset["aspect_ratio"] == "4:5"
    assert asset["original_filename"] == "evil name.webp" and asset["is_primary"]
    download = client.get(root + f"/media/{asset['id']}?download=true")
    assert download.status_code == 200 and download.headers["content-disposition"].startswith("attachment") and "evil" in download.headers["content-disposition"]
    assert ".." not in download.headers["content-disposition"]
    stored = db.get(PostAsset, asset["id"])
    assert stored.job_id is None and stored.storage_key.startswith(c["id"])
    original = ai_settings.max_image_bytes
    try:
        ai_settings.max_image_bytes = 2000
        assert client.post(root + f"/posts/{post['id']}/assets/upload?revision={webp.json()['post']['revision']}", content=png(size=(900, 900)), headers={"Content-Type": "image/png"}).status_code == 413
    finally:
        ai_settings.max_image_bytes = original
    other = User(full_name="Other", email=f"other-{uuid4().hex}@example.com", hashed_password=owner.hashed_password)
    db.add(other); db.commit(); client.cookies.set("access_token", create_access_token(other.id))
    assert client.get(root + f"/media/{asset['id']}").status_code == 404
    assert client.post(upload, content=png(), headers={"Content-Type": "image/png"}).status_code == 404
    for path in (f"/posts/{post['id']}/versions", f"/posts/{post['id']}/assets"):
        assert client.get(root + path).status_code == 404
    assert client.put(root + f"/posts/{post['id']}/primary-asset", json={"revision": 1, "asset_id": None}).status_code == 404


def test_archived_post_rejects_image_changes(client, setup):
    _, root = setup
    post = new_post(client, root)
    archived = client.patch(root + f"/posts/{post['id']}", json={**draft(), "revision": post["revision"], "status": "archived"}).json()
    assert client.post(root + f"/posts/{post['id']}/assets/upload?revision={archived['revision']}", content=png(), headers={"Content-Type": "image/png"}).status_code == 422
    assert client.post(root + f"/posts/{post['id']}/images", json={"request_key": str(uuid4())}).status_code == 422


# ---------- duplication, caption regeneration and versions ----------

def test_duplicate_copies_primary_image_independently(client, db, setup):
    _, root = setup
    post = new_post(client, root)
    uploaded = client.post(root + f"/posts/{post['id']}/assets/upload?revision={post['revision']}", content=png(), headers={"Content-Type": "image/png"}).json()
    copy = client.post(root + f"/posts/{post['id']}/duplicate", json={"request_key": str(uuid4())}).json()
    copied = client.get(root + f"/posts/{copy['id']}/assets").json()
    assert len(copied) == 1 and copied[0]["source"] == "duplicated" and copied[0]["id"] != uploaded["asset"]["id"]
    assert copy["primary_asset_id"] == copied[0]["id"]
    assert len(client.get(root + f"/posts/{post['id']}/assets").json()) == 1


def test_caption_regeneration_keeps_image_and_history(client, db, setup, monkeypatch):
    c, root = setup
    post = new_post(client, root)
    post = client.post(root + f"/posts/{post['id']}/assets/upload?revision={post['revision']}", content=png(), headers={"Content-Type": "image/png"}).json()["post"]
    job = client.post(root + f"/posts/{post['id']}/regenerate", json={"request_key": str(uuid4()), "mode": "caption"}).json()
    payload = db.get(AIJob, job["id"]).payload["request"]
    assert payload["regenerate_mode"] == "caption" and "Rewrite ONLY the caption" in payload["instructions"]
    assert client.post(root + f"/posts/{post['id']}/regenerate", json={"request_key": str(uuid4()), "mode": "other"}).status_code == 422
    applied = client.patch(root + f"/posts/{post['id']}", json={**draft(caption="A fresh Engineering caption", hashtags=["#Fresh"]), "revision": post["revision"], "status": "draft"}).json()
    assert applied["primary_asset_id"] == post["primary_asset_id"]  # image untouched
    versions = client.get(root + f"/posts/{post['id']}/versions").json()
    assert versions[0]["snapshot"]["caption"] == draft()["caption"] and versions[0]["revision"] == post["revision"]
    assert [v["revision"] for v in versions] == sorted({v["revision"] for v in versions}, reverse=True)


def test_post_versions_are_append_only(client, db, setup):
    _, root = setup
    post = new_post(client, root)
    client.patch(root + f"/posts/{post['id']}", json={**draft(caption="Changed Engineering"), "revision": post["revision"], "status": "draft"})
    version = db.scalar(select(PostVersion).where(PostVersion.post_id == post["id"]))
    assert version.snapshot["caption"] == draft()["caption"]
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE post_versions SET revision = 99 WHERE id = :id"), {"id": version.id}); db.flush()
    db.rollback()


# ---------- provider and brief ----------

def test_image_brief_is_brand_specific_and_bounded():
    context = {"company_name": "Brew & Bean", "industry": "Coffee", "products_services": ["Single-origin beans"], "target_audience": "Home brewers",
               "brand_voice": ["Warm"], "brand_colors": ["#0b0b0b", "#ff2dab"], "preferences": {"excluded_topics": ["Politics"]},
               "competitor_insights": [{"themes": ["Latte art"]}]}
    brief = post_media.image_brief(context, {"platform": "Instagram", "content_type": "image", "title": "Morning ritual", "image_prompt": "Steam over a cup"}, "4:5", "x" * 900)
    for expected in ("Coffee", "Single-origin beans", "Home brewers", "#0b0b0b, #ff2dab", "4:5", "Steam over a cup", "Politics", "Latte art", "No logos"):
        assert expected in brief
    assert len(brief) <= 4000 and "x" * 501 not in brief


def test_provider_errors_and_ratio_validation(monkeypatch):
    monkeypatch.setattr(ai_settings, "gemini_image_model", "test-image-model")
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(supported_actions=["generateContent"])),
                                                                         generate_content=AsyncMock(side_effect=errors.APIError(429, {"error": {"message": "quota"}})))))
    provider = GoogleImageProvider(client)
    with pytest.raises(ExtractionError) as error:
        asyncio.run(provider.generate("brief", "9:7"))
    assert error.value.code == "unsupported_aspect_ratio"
    with pytest.raises(ExtractionError) as error:
        asyncio.run(provider.generate("brief", "4:5"))
    assert error.value.code == "image_quota" and not error.value.transient
    client.aio.models.generate_content = AsyncMock(side_effect=errors.APIError(503, {"error": {"message": "busy"}}))
    with pytest.raises(ExtractionError) as error:
        asyncio.run(provider.generate("brief", "1:1"))
    assert error.value.transient


def test_hex_colours_in_visual_concept_are_not_numeric_claims():
    # Regression from the live smoke: brand palettes in image_prompt were rejected as numeric claims.
    from app.schemas.content import ContentDraft, GeneratedContent
    from app.services.content_generation import validate_quality
    context = {"company_name": "Brew", "industry": "Coffee", "products_services": ["Coffee beans"], "preferences": {}}
    request = {"platforms": ["Instagram"], "content_type": "image", "topic": "Roast"}
    ok = GeneratedContent(posts=[ContentDraft(**draft(content_type="image", caption="Fresh coffee beans roasted for you", image_prompt="Beans in palette #3b2417 and #d4a373, 3 cups, 4:5"))])
    assert validate_quality(ok, context, request)
    claim = GeneratedContent(posts=[ContentDraft(**draft(content_type="image", caption="Coffee beans 50% fresher", image_prompt="Beans"))])
    with pytest.raises(ValueError):
        validate_quality(claim, context, request)
