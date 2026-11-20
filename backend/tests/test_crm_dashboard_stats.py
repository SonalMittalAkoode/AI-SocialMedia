"""Overview statistics and Post Library date/media filters match real records exactly."""
import io
from datetime import datetime, timedelta, timezone
from uuid import uuid4, UUID
import pytest
from PIL import Image
from sqlalchemy import update
from app.core.intelligence_config import ai_settings
from app.core.security import create_access_token
from app.models.content import Post
from app.models.intelligence import AIJob, Competitor, CompetitorResearch
from app.models.user import User
from app.services import crm
from test_onboarding import owner, workspace, company  # noqa: F401
from test_content import draft
from test_scheduling_models import schedule


def png():
    data = io.BytesIO(); Image.new("RGB", (120, 120), "teal").save(data, format="PNG"); return data.getvalue()


@pytest.fixture
def setup(client, owner, monkeypatch, tmp_path):
    monkeypatch.setattr(ai_settings, "media_root", tmp_path)
    c = company(client, workspace(client)["id"]); root = f"/api/v1/companies/{c['id']}"
    client.post(root + "/brand/confirm", json={"revision": 1})
    return c, root


def post(client, root, **changes):
    response = client.post(root + "/posts", json=draft(creation_key=str(uuid4()), **changes)); assert response.status_code == 201
    return response.json()


def test_overview_content_and_competitor_statistics(client, db, owner, setup):
    c, root = setup
    company_id = UUID(c["id"])
    two = AIJob(company_id=company_id, requested_by=owner.id, kind="content_generation", request_key=uuid4(), status="completed", payload={"context": {"brand_revision": 1}, "request": {"topic": "t"}},
                result={"posts": [draft(), draft(platform="X", caption="Explore Engineering ideas on X")], "strategy": {}, "warnings": []})
    failed = AIJob(company_id=company_id, requested_by=owner.id, kind="content_generation", request_key=uuid4(), status="failed", payload={})
    queued = AIJob(company_id=company_id, requested_by=owner.id, kind="content_generation", request_key=uuid4(), status="queued", payload={})
    db.add_all([two, failed, queued]); db.commit()
    brand_revision = client.get(root + "/brand").json()["revision"]
    two.payload = {"context": {"brand_revision": brand_revision}, "request": {"topic": "t"}}; db.commit()
    saved = client.post(root + "/posts", json={**draft(), "creation_key": str(uuid4()), "generation_job_id": str(two.id), "result_index": 0})
    assert saved.status_code == 201, saved.text
    manual = post(client, root)
    client.post(root + f"/posts/{manual['id']}/assets/upload?revision={manual['revision']}", content=png(), headers={"Content-Type": "image/png"})
    a = Competitor(company_id=company_id, name="Alpha", website_url="https://alpha.org", normalized_domain="alpha.org", source_url="https://alpha.org", selection_status="approved", verification_status="verified")
    b = Competitor(company_id=company_id, name="Beta", website_url="https://beta.org", normalized_domain="beta.org", source_url="https://beta.org", selection_status="approved")
    gone = Competitor(company_id=company_id, name="Gone", website_url="https://gone.org", normalized_domain="gone.org", source_url="https://gone.org", removed_at=datetime.now(timezone.utc))
    db.add_all([a, b, gone]); db.flush()
    research = AIJob(company_id=company_id, requested_by=owner.id, kind="competitor_research", request_key=uuid4(), status="completed", payload={})
    db.add(research); db.flush()
    db.add(CompetitorResearch(company_id=company_id, competitor_id=a.id, job_id=research.id, data={}, source_evidence=[], model_identifier="t")); db.commit()
    summary = client.get(root + "/dashboard/summary").json()
    assert summary["content_stats"] == {"generated_posts": 2, "saved_from_generation": 1, "manual_posts": 1, "generation_jobs_completed": 1,
                                        "generation_jobs_failed": 1, "generation_jobs_active": 1, "images_generated": 0, "images_uploaded": 1, "posts_with_images": 1}
    assert summary["competitor_stats"] == {"tracked": 2, "researched": 1, "approved": 2, "informing_generation": 1}
    assert summary["total_posts"] == 2 and summary["publishing_available"] is False and summary["analytics_available"] is False


def test_library_date_filter_uses_company_timezone_and_media_filter(client, db, setup):
    c, root = setup
    assert client.patch(root + "/scheduling-preferences", json={"revision": client.get(root).json()["revision"], "timezone": "Asia/Kolkata"}).is_success
    early, late, plain = post(client, root, title="Early post"), post(client, root, title="Late post"), post(client, root, title="Text only")
    # 2026-03-01 23:30 IST == 18:00 UTC; 2026-03-02 00:30 IST == 2026-03-01 19:00 UTC.
    db.execute(update(Post).where(Post.id == early["id"]).values(created_at=datetime(2026, 3, 1, 18, 0, tzinfo=timezone.utc)))
    db.execute(update(Post).where(Post.id == late["id"]).values(created_at=datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc)))
    db.execute(update(Post).where(Post.id == plain["id"]).values(created_at=datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)))
    db.commit()
    day = client.get(root + "/post-library?created_from=2026-03-01&created_to=2026-03-01").json()
    assert [p["title"] for p in day["items"]] == ["Early post"] and day["company_timezone"] == "Asia/Kolkata"
    march = client.get(root + "/post-library?created_from=2026-03-01&created_to=2026-03-31").json()
    assert {p["title"] for p in march["items"]} == {"Early post", "Late post"} and march["total"] == 2
    assert client.get(root + "/post-library?created_from=2026-04-02&created_to=2026-04-01").status_code == 422
    current = client.get(root + f"/posts/{late['id']}").json()
    first = client.post(root + f"/posts/{late['id']}/assets/upload?revision={current['revision']}", content=png(), headers={"Content-Type": "image/png"}).json()
    second = client.post(root + f"/posts/{late['id']}/assets/upload?revision={first['post']['revision']}", content=png(), headers={"Content-Type": "image/png"}).json()
    client.put(root + f"/posts/{late['id']}/primary-asset", json={"revision": second["post"]["revision"], "asset_id": first["asset"]["id"]})
    with_image = client.get(root + "/post-library?media=with_image").json()["items"]
    assert [p["title"] for p in with_image] == ["Late post"]
    assert with_image[0]["preview_asset_id"] == first["asset"]["id"]  # the chosen image, not the newest
    assert with_image[0]["asset_count"] == 2
    text_only = client.get(root + "/post-library?media=text_only&sort=created_asc").json()["items"]
    assert [p["title"] for p in text_only] == ["Early post", "Text only"]
    assert client.get(root + "/post-library?media=everything").status_code == 422


def test_new_filters_remain_tenant_isolated(client, db, owner, setup):
    _, root = setup
    other = User(full_name="Other", email=f"other-{uuid4().hex}@example.com", hashed_password=owner.hashed_password)
    db.add(other); db.commit(); client.cookies.set("access_token", create_access_token(other.id))
    assert client.get(root + "/post-library?created_from=2026-01-01&media=with_image").status_code == 404
    assert client.get(root + "/dashboard/summary").status_code == 404


def test_upcoming_projection_keeps_active_future_rows_and_legacy_counts(client, db, setup, monkeypatch):
    _, root = setup
    now = datetime.now(timezone.utc)

    def planned(title, days):
        saved = post(client, root, title=title)
        assert client.post(root + f"/posts/{saved['id']}/approve", json={"revision": saved["revision"]}).is_success
        row = db.get(Post, UUID(saved["id"]))
        return row, schedule(db, row, scheduled_at=now + timedelta(days=days))

    _, scheduled = planned("Future", 6)
    blocked_post, blocked = planned("Blocked future", 5)
    _, cancelled = planned("Cancelled future", 4)
    _, earlier = planned("Overdue", 2)
    db.commit()
    blocked_post.caption = "Changes to the approved content need review."
    db.commit()
    assert client.post(root + f"/schedules/{cancelled.id}/cancel", json={"revision": cancelled.revision}).is_success

    class OverviewClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now + timedelta(days=3)

    monkeypatch.setattr(crm, "datetime", OverviewClock)
    overview = client.get(root + "/dashboard/summary").json()
    assert overview["upcoming_scheduled_posts"] == 2
    assert [(row["id"], row["status"]) for row in overview["upcoming_active_schedules"]] == [
        (str(blocked.id), "blocked"), (str(scheduled.id), "scheduled"),
    ]
    assert [row["id"] for row in overview["upcoming_schedules"]] == [str(scheduled.id)]
    assert overview["scheduled_posts"] == 2  # Includes the overdue row until the scheduler transitions it.
    assert str(earlier.id) not in [row["id"] for row in overview["upcoming_active_schedules"]]
