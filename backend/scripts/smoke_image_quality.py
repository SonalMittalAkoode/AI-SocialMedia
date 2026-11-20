"""Opt-in live end-to-end check of Phase 8A.1 image quality through the real API and the
running shared worker. Creates (and retains) its own smoke account and fictional brand.

From backend/ with the API on :8000 and the worker running:
    python scripts/smoke_image_quality.py --run-live --max-images 3

Steps: one text+image generation (lifestyle style, 4:5) -> save -> approve -> background edit
variation (approved post returns to draft) -> 9:16 platform variation -> accept review ->
download and re-login. At most 3 images and 2 text calls. Never prints secrets.
"""
import argparse
import io
import secrets
import sys
import time
from pathlib import Path
from uuid import uuid4
import httpx
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.intelligence_config import ai_settings

OUT = Path(__file__).resolve().parents[2] / "frontend" / "artifacts" / "quality-benchmark"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-live", action="store_true")
    parser.add_argument("--max-images", type=int, default=0)
    args = parser.parse_args()
    if not args.run_live or args.max_images != 3:
        parser.error("Explicit --run-live --max-images 3 required")
    if not ai_settings.gemini_image_model:
        parser.error("An image model must be configured")
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url="http://localhost:8000/api/v1", headers={"Origin": "http://localhost:3000"}, timeout=30) as client:
        def call(method, path, data=None):
            response = client.request(method, path, json=data)
            if response.is_error:
                raise RuntimeError(f"HTTP {response.status_code} {path}: {response.text[:300]}")
            return response

        def wait(path, limit=200):
            for _ in range(limit):
                job = call("GET", path).json()
                if job["status"] not in ("queued", "running"):
                    return job
                time.sleep(2)
            raise RuntimeError("Timed out waiting for the shared worker")

        password = "Smoke123!" + secrets.token_urlsafe(24)
        email = f"quality-smoke-{uuid4().hex}@example.com"
        call("POST", "/auth/register", {"full_name": "Quality Smoke", "email": email, "password": password})
        call("POST", "/auth/login", {"email": email, "password": password})
        workspace = call("POST", "/workspaces", {"name": "Image quality smoke"}).json()
        company = call("POST", f"/workspaces/{workspace['id']}/companies", {"name": "Harbor Light Travel", "industry": "Travel agency",
                                                                               "description": "A small travel agency planning coastal walking holidays in Portugal."}).json()
        root = f"/companies/{company['id']}"
        brand = call("GET", root + "/brand").json()
        call("PATCH", root + "/brand", {"revision": brand["revision"], "display_name": "Harbor Light Travel",
                                        "description": "A small travel agency planning coastal walking holidays in Portugal.",
                                        "products_services": ["Guided coastal walking holidays", "Self-guided trail itineraries"],
                                        "target_audience": "Active travellers aged 35-60", "brand_voice": ["Warm", "Knowledgeable"],
                                        "brand_colors": ["#1d4e89", "#f2a65a", "#f7f3e9"]})
        brand = call("GET", root + "/brand").json(); call("POST", root + "/brand/confirm", {"revision": brand["revision"]})
        job = call("POST", root + "/content-generations", {"request_key": str(uuid4()), "platforms": ["Instagram"], "content_type": "image",
                                                            "topic": "What a day on a guided coastal walk looks like", "objective": "brand_awareness",
                                                            "include_images": True, "aspect_ratios": {"Instagram": "4:5"},
                                                            "image_options": {"visual_style": "lifestyle", "subject_emphasis": "environment"}}).json()
        print({"company_id": company["id"], "generation_job": job["id"]}, flush=True)
        text = wait(root + f"/content-generations/{job['id']}")
        print({"text_status": text["status"], "error": text["error_code"]}, flush=True)
        if text["status"] != "completed":
            raise SystemExit(1)
        result = call("GET", root + f"/content-generations/{job['id']}/result").json()
        post = result["posts"][0]
        print({"caption": post["caption"], "hashtags": post["hashtags"], "cta": post["call_to_action"],
               "quality": {c["id"]: c["status"] for c in result["quality"][0]["checks"]}, "meta": result["generation_meta"]}, flush=True)
        for image_job in result.get("image_jobs", []):
            wait(f"{root}/ai-jobs/{image_job['job_id']}")
        media = call("GET", root + f"/content-generations/{job['id']}/media").json()
        print({"image_jobs": [(j["status"], j["error_code"]) for j in media["jobs"]]}, flush=True)
        saved = call("POST", root + "/posts", {**post, "creation_key": str(uuid4()), "generation_job_id": job["id"], "result_index": 0}).json()
        if not saved["primary_asset_id"]:
            raise SystemExit("No image was attached")
        approved = call("POST", root + f"/posts/{saved['id']}/approve", {"revision": call("GET", root + f"/posts/{saved['id']}").json()["revision"]}).json()
        edit = call("POST", root + f"/posts/{saved['id']}/images", {"request_key": str(uuid4()), "operation": "background", "options": {"background": "light"}}).json()
        print({"edit_job": wait(root + f"/ai-jobs/{edit['id']}")["status"]}, flush=True)
        after_edit = call("GET", root + f"/posts/{saved['id']}").json()
        print({"approved_status": approved["status"], "after_variation_status": after_edit["status"], "revision": [approved["revision"], after_edit["revision"]]}, flush=True)
        story = call("POST", root + f"/posts/{saved['id']}/images", {"request_key": str(uuid4()), "operation": "platform", "aspect_ratio": "9:16"}).json()
        print({"story_job": wait(root + f"/ai-jobs/{story['id']}")["status"]}, flush=True)
        assets = call("GET", root + f"/posts/{saved['id']}/assets").json()
        call("POST", root + f"/media/{assets[0]['id']}/review", {"decision": "accepted"})
        client.cookies.clear(); call("POST", "/auth/login", {"email": email, "password": password})
        assets = call("GET", root + f"/posts/{saved['id']}/assets").json()
        for asset in sorted(assets, key=lambda a: a["created_at"]):
            raw = call("GET", root + f"/media/{asset['id']}?download=true").content
            with Image.open(io.BytesIO(raw)) as im:
                size = im.size
            name = f"pipeline-{asset['operation'] or 'generated'}-{asset['aspect_ratio'].replace(':', 'x')}.png"
            (OUT / name).write_bytes(raw)
            print({"file": name, "aspect": asset["aspect_ratio"], "pixels": size, "mode": asset["generation_mode"], "parent": bool(asset["parent_asset_id"]),
                   "prompt_version": asset["prompt_version"], "quality": asset["quality_status"], "duration_ms": asset["duration_ms"],
                   "checks": {c["id"]: c["status"] for c in (asset["quality_report"] or {}).get("checks", [])},
                   "review": asset["review_decision"], "primary": asset["is_primary"]}, flush=True)


if __name__ == "__main__":
    main()
