"""Opt-in live text + image smoke through the application. Retains its smoke records.

From backend/: python scripts/smoke_image_generation.py --run-live --max-images 3

One structured text generation (<=2 text calls) for Instagram + LinkedIn with images,
then <=2 result images and 1 regenerated post image via the configured image model.
Jobs for this company are claimed and run in-process with the current code. Writes
downloaded images to the given --out directory for visual inspection. Never prints secrets.
"""
import argparse
import asyncio
import io
import secrets
import sys
from pathlib import Path
from uuid import uuid4
import httpx
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services.gemini_brand_analyzer import GeminiBrandAnalyzer
from app.services import ai_queue
from app.db.database import SessionLocal
from app.models import user, content, brand_extraction  # noqa: F401
from app.workers.intelligence import run_job


async def run_company_jobs(company_id, analyzer, limit):
    done = []
    for _ in range(limit):
        with SessionLocal() as db:
            claimed = ai_queue.claim(db, company_id=company_id)
        if not claimed:
            break
        await run_job(claimed, analyzer)
        done.append(str(claimed[0]))
    return done


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-live", action="store_true")
    parser.add_argument("--max-images", type=int, default=0)
    parser.add_argument("--out", default="var/smoke-images")
    args = parser.parse_args()
    if not args.run_live or args.max_images != 3:
        parser.error("Explicit --run-live --max-images 3 required")
    if not ai_settings.gemini_image_model or settings.GEMINI_MODEL != "gemini-2.5-flash":
        parser.error("Configured text gemini-2.5-flash and an image model are required")
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url="http://localhost:8000/api/v1", headers={"Origin": "http://localhost:3000"}, timeout=30) as client:
        def call(method, path, data=None, **kw):
            response = client.request(method, path, json=data, **kw)
            if response.is_error:
                raise RuntimeError(f"Smoke API HTTP {response.status_code}: {response.text[:300]}")
            return response
        password = "Smoke123!" + secrets.token_urlsafe(24)
        email = f"image-smoke-{uuid4().hex}@example.com"
        call("POST", "/auth/register", {"full_name": "Image Smoke", "email": email, "password": password})
        call("POST", "/auth/login", {"email": email, "password": password})
        workspace = call("POST", "/workspaces", {"name": "Live image smoke"}).json()
        company = call("POST", f"/workspaces/{workspace['id']}/companies", {"name": "Brew & Bean Roasters", "industry": "Specialty coffee", "description": "Small-batch specialty coffee roaster and neighbourhood cafe."}).json()
        root = f"/companies/{company['id']}"
        brand = call("GET", root + "/brand").json()
        call("PATCH", root + "/brand", {"revision": brand["revision"], "display_name": "Brew & Bean Roasters", "description": "Small-batch specialty coffee roaster and neighbourhood cafe.",
                                        "products_services": ["Single-origin coffee beans", "Brewing workshops"], "target_audience": "Home brewers and coffee lovers",
                                        "brand_voice": ["Warm", "Knowledgeable"], "brand_colors": ["#3b2417", "#d4a373", "#f5ebe0"]})
        brand = call("GET", root + "/brand").json(); call("POST", root + "/brand/confirm", {"revision": brand["revision"]})
        job = call("POST", root + "/content-generations", {"request_key": str(uuid4()), "platforms": ["Instagram", "LinkedIn"], "content_type": "image",
                                                            "topic": "Our new Ethiopian single-origin roast", "include_images": True}).json()
        print({"company_id": company["id"], "generation_job": job["id"], "text_model": settings.GEMINI_MODEL, "image_model": ai_settings.gemini_image_model}, flush=True)
        analyzer = GeminiBrandAnalyzer()
        try:
            await run_company_jobs(company["id"], analyzer, 1)  # text
            text_status = call("GET", root + f"/content-generations/{job['id']}").json()
            print({"text_status": text_status["status"], "error": text_status["error_code"]}, flush=True)
            if text_status["status"] != "completed":
                raise SystemExit(1)
            result = call("GET", root + f"/content-generations/{job['id']}/result").json()
            for i, post in enumerate(result["posts"]):
                print({"result": i, "platform": post["platform"], "title": post["title"], "caption": post["caption"][:160], "hashtags": post["hashtags"], "cta": post["call_to_action"]}, flush=True)
            await run_company_jobs(company["id"], analyzer, 2)  # result images
            media = call("GET", root + f"/content-generations/{job['id']}/media").json()
            print({"image_jobs": [(j["result_index"], j["aspect_ratio"], j["status"], j["error_code"]) for j in media["jobs"]]}, flush=True)
            saved = call("POST", root + "/posts", {**result["posts"][0], "creation_key": str(uuid4()), "generation_job_id": job["id"], "result_index": 0}).json()
            assets = call("GET", root + f"/posts/{saved['id']}/assets").json()
            print({"saved_post": saved["id"], "linked_assets": len(assets), "primary": saved["primary_asset_id"] is not None}, flush=True)
            if saved["primary_asset_id"]:
                regen = call("POST", root + f"/posts/{saved['id']}/images", {"request_key": str(uuid4()), "instructions": "Overhead flat-lay variation"}).json()
                await run_company_jobs(company["id"], analyzer, 1)
                print({"regenerate_job": call("GET", root + f"/ai-jobs/{regen['id']}").json()["status"]}, flush=True)
        finally:
            await analyzer.close()
        for asset in media["assets"] + call("GET", root + f"/posts/{saved['id']}/assets").json():
            raw = call("GET", root + f"/media/{asset['id']}?download=true").content
            with Image.open(io.BytesIO(raw)) as im:
                size = im.size
            path = out / f"{asset['id']}.png"; path.write_bytes(raw)
            print({"asset": asset["id"], "result_index": asset.get("result_index"), "aspect": asset["aspect_ratio"], "pixels": size, "bytes": len(raw), "file": str(path)}, flush=True)
        client.cookies.clear(); call("POST", "/auth/login", {"email": email, "password": password})
        print({"after_relogin_assets": len(call("GET", root + f"/posts/{saved['id']}/assets").json())}, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
