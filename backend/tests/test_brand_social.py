import asyncio
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
from sqlalchemy import select

from app.models.intelligence import AIJob
from app.services import ai_queue, brand_social, content_handlers
from app.services.content_generation import strategy
from test_onboarding import company, owner, workspace


def test_meta_samples_use_fixed_authorized_endpoints_and_retain_only_patterns(monkeypatch):
    company_id = uuid4()
    account = brand_social.MetaAccount(
        company_id=company_id, instagram_account_id="123", instagram_user_token="fixture-secret",
        facebook_page_id="456", facebook_page_token="fixture-page-secret",
    )
    monkeypatch.setattr(brand_social.settings, "meta_accounts", [account])
    assert brand_social.sources_for(uuid4()) == []
    instagram, facebook = sorted(brand_social.sources_for(company_id), key=lambda source: source.platform, reverse=True)

    def respond(request):
        assert request.url.host == "graph.facebook.com"
        assert request.method == "GET"
        assert request.url.params["limit"] == "6"
        if request.url.path.endswith("/123/media"):
            assert request.headers["Authorization"] == "Bearer fixture-secret"
            return httpx.Response(200, json={"data": [
                {"caption": "Behind the scenes at our private fixture phrase.\nLearn more #studio", "media_product_type": "REELS"},
                {"media_type": "CAROUSEL_ALBUM"},
            ]})
        assert request.url.path.endswith("/456/published_posts")
        return httpx.Response(403, json={"error": {"message": "provider response contains a secret"}})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            profile, warning = await brand_social.read_source(client, instagram)
            assert warning is None
            assert profile["formats"] == {"Reel": 1, "Carousel": 1}
            assert profile["topics"] == ["Behind the scenes"]
            assert profile["posts_sampled"] == 2
            assert profile["captions_sampled"] == 1
            assert "private fixture phrase" not in json.dumps(profile)
            skipped, issue = await brand_social.read_source(client, facebook)
            assert skipped is None and issue.startswith("Could not read authorized Facebook posts.")
            assert "secret" not in issue

    asyncio.run(check())


def test_pasted_captions_inform_generation_without_storing_caption_text(client, db, owner):
    record = company(client, workspace(client)["id"])
    root = f"/api/v1/companies/{record['id']}"
    assert client.post(root + "/brand/confirm", json={"revision": 1}).status_code == 200
    captions = ["How to style a scarf?\nLearn more #scarves", "Introducing our collection of sample fixtures #textiles"]
    response = client.post(root + "/content-generations", json={
        "request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Fabric choices",
        "use_recent_social_posts": False, "published_caption_examples": captions,
    })
    assert response.status_code == 202
    job = db.scalar(select(AIJob).where(AIJob.id == response.json()["id"]))
    assert "published_caption_examples" not in job.payload["request"]
    assert all(caption not in json.dumps(job.payload) for caption in captions)
    plan = strategy(job.payload["context"], job.payload["request"])
    [profile] = plan["published_social_style"]
    assert profile["posts_sampled"] == 2
    assert set(profile["topics"]) == {"Tips and education", "Product showcases", "Launches and announcements"}
    assert profile["question_openings"] == 1
    assert profile["formats"] == {}


def test_worker_supplies_authorized_publication_profile_to_generation(client, db, owner, monkeypatch):
    record = company(client, workspace(client)["id"])
    from uuid import UUID
    company_id = UUID(record["id"])
    root = f"/api/v1/companies/{company_id}"
    account = brand_social.MetaAccount(company_id=company_id, instagram_account_id="123", instagram_user_token="fixture")
    monkeypatch.setattr(brand_social.settings, "meta_accounts", [account])
    assert client.get(root + "/ai-capabilities").json()["published_social_sources"] == ["Instagram"]
    assert client.post(root + "/brand/confirm", json={"revision": 1}).status_code == 200
    response = client.post(root + "/content-generations", json={
        "request_key": str(uuid4()), "platforms": ["Instagram"], "topic": "Fabric choices",
    })
    assert response.status_code == 202
    profile = brand_social.editorial_profile("Instagram", [("In the studio today", "Carousel")])
    read = AsyncMock(return_value=([profile], []))
    monkeypatch.setattr(brand_social, "read_company_style", read)

    async def generate(_client, payload):
        return {"posts": [], "warnings": [], "strategy": strategy(payload["context"], payload["request"])}, {}

    monkeypatch.setattr(content_handlers, "generate", generate)
    claimed = ai_queue.claim(db, company_id=company_id)
    asyncio.run(content_handlers.handle_content_job(claimed, SimpleNamespace(client=None), lambda: nullcontext(db)))
    read.assert_awaited_once_with(company_id)
    completed = client.get(root + f"/content-generations/{response.json()['id']}/result").json()
    assert completed["strategy"]["published_social_style"] == [profile]
