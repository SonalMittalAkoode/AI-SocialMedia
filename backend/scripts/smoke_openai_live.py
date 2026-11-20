"""Opt-in, bounded live check of the OpenAI provider through the real API and shared worker.

Creates (and retains) its own smoke account, workspace and company; real brand records are never
modified. Run from backend/ with the API on :8000 and the worker running with AI_PROVIDER=openai:

    python scripts/smoke_openai_live.py --run-live --max-images 2 --steps all

Upper bound per full run: 1 website analysis job (<=2 research-model calls), 1 competitor research
(<=2 analysis + <=2 assessment calls), 1 web search call, 1 caption generation (<=2 text-model
calls) and 2 images (1 generation + 1 reference edit, quality from AI_OPENAI_IMAGE_QUALITY).
Transient errors are retried at most AI_OPENAI_MAX_ATTEMPTS times; billing errors never.
Stops at the first failure. Prints no secrets, only statuses, model IDs, sizes and token usage.
"""
import argparse
import io
import json
import secrets
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import ai_provider  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "artifacts" / "openai-migration"
STEPS = ("company", "competitor", "search", "captions", "images")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-live", action="store_true")
    parser.add_argument("--max-images", type=int, default=0)
    parser.add_argument("--steps", default="all", help="comma list of " + ",".join(STEPS))
    parser.add_argument("--company-url", default="https://akoode.com")
    parser.add_argument("--competitor-url", default="https://www.thoughtworks.com")
    args = parser.parse_args()
    steps = STEPS if args.steps == "all" else tuple(s for s in args.steps.split(",") if s in STEPS)
    if not args.run_live or ("images" in steps and args.max_images != 2):
        parser.error("Explicit --run-live (and --max-images 2 when images are included) is required")
    if not ai_provider.is_openai() or not ai_provider.text_configured():
        parser.error("AI_PROVIDER must be openai with OpenAI models configured")
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"models": {"text": ai_provider.text_model(), "research": ai_provider.research_model(),
                         "image": ai_provider.image_model(), "edit_image": ai_provider.image_model(True)}, "steps": {}}
    with httpx.Client(base_url="http://localhost:8000/api/v1", headers={"Origin": "http://localhost:3000"}, timeout=120) as client:
        def call(method, path, data=None):
            response = client.request(method, path, json=data)
            if response.is_error:
                raise RuntimeError(f"HTTP {response.status_code} {path}: {response.text[:300]}")
            return response

        def wait(path, limit=150):
            for _ in range(limit):
                job = call("GET", path).json()
                if job["status"] not in ("queued", "running"):
                    return job
                time.sleep(2)
            raise RuntimeError("Timed out waiting for the shared worker")

        def record(step, data, ok=True):
            report["steps"][step] = {"ok": ok, **data}
            print(json.dumps({step: report["steps"][step]}, default=str), flush=True)
            if not ok:
                (OUT / "live-report.json").write_text(json.dumps(report, indent=2, default=str))
                raise SystemExit(1)

        password = "Smoke123!" + secrets.token_urlsafe(24)
        email = f"openai-smoke-{uuid4().hex}@example.com"
        call("POST", "/auth/register", {"full_name": "OpenAI Smoke", "email": email, "password": password})
        call("POST", "/auth/login", {"email": email, "password": password})
        workspace = call("POST", "/workspaces", {"name": "OpenAI migration smoke"}).json()
        company = call("POST", f"/workspaces/{workspace['id']}/companies", {"name": "Akoode Technologies", "industry": "Software development",
                                                                               "description": "A software company building custom AI and web solutions."}).json()
        root = f"/companies/{company['id']}"
        report["company_id"] = company["id"]
        caps = call("GET", root + "/ai-capabilities").json()
        report["capabilities"] = {k: caps.get(k) for k in ("ai_provider", "search_provider", "search_available", "image_available", "text_available", "image_edit_enabled")}
        print(json.dumps(report["capabilities"]), flush=True)

        if "company" in steps:
            job = call("POST", root + "/brand-extractions", {"url": args.company_url}).json()
            done = wait(root + f"/brand-extractions/{job['id']}")
            if done["status"] != "completed":
                record("company", {"status": done["status"], "error": done.get("error_code")}, False)
            result = call("GET", root + f"/brand-extractions/{job['id']}/result").json()
            findings = result["extracted_data"]
            evidence = result["source_evidence"]
            record("company", {"status": done["status"], "model": result["model_identifier"], "usage": done.get("token_usage"),
                               "company_name": findings.get("company_name"), "industry": findings.get("industry"),
                               "city": findings.get("city"), "country": findings.get("country"),
                               "services": (findings.get("products_services") or [])[:4], "voice": findings.get("brand_voice"),
                               "evidence_items": len(evidence), "evidence_classes": sorted({e.get("classification") for e in evidence})})
            # Findings are not applied: the smoke brand below is entered manually and confirmed.
        brand = call("GET", root + "/brand").json()
        call("PATCH", root + "/brand", {"revision": brand["revision"], "display_name": "Akoode Technologies",
                                        "description": "A software company building custom AI and web solutions for growing businesses.",
                                        "products_services": ["Custom AI solutions", "Web application development"],
                                        "target_audience": "Founders and operations leads at growing businesses",
                                        "brand_voice": ["Clear", "Practical"], "brand_colors": ["#1d4e89", "#f2a65a", "#f7f3e9"]})
        brand = call("GET", root + "/brand").json()
        call("POST", root + "/brand/confirm", {"revision": brand["revision"]})

        if "competitor" in steps:
            competitor = call("POST", root + "/competitors", {"name": "Thoughtworks", "website_url": args.competitor_url}).json()
            job = call("POST", root + f"/competitors/{competitor['id']}/research", {"request_key": str(uuid4())}).json()
            done = wait(root + f"/ai-jobs/{job['id']}")
            if done["status"] != "completed":
                record("competitor", {"status": done["status"], "error": done.get("error_code")}, False)
            insight = call("GET", root + f"/competitor-insights?competitor_id={competitor['id']}").json()[0]
            data = insight["data"]
            record("competitor", {"status": done["status"], "model": insight["model_identifier"], "usage": done.get("token_usage"),
                                  "verification": data.get("verification_status"), "relevance": data.get("relevance_score"),
                                  "assessment": data.get("assessment_status"), "fit": data.get("fit"), "positioning": (data.get("market_positioning") or "")[:200],
                                  "evidence_items": len(insight["source_evidence"]), "warnings": data.get("warnings", [])[:3]})

        if "search" in steps:
            started = time.monotonic()
            answer = call("POST", root + "/competitor-search", {"request_key": str(uuid4())}).json()
            journal = call("GET", root + "/ai-jobs?kind=competitor_discovery&limit=1").json()[0]
            stored = call("GET", root + "/competitors").json()
            record("search", {"provider": answer["provider"], "sources": [s["uri"] for s in answer["sources"]][:6],
                              "citations": len(answer["citations"]), "answer_chars": len(answer["text"]),
                              "duration_s": round(time.monotonic() - started, 1), "usage": journal.get("token_usage"),
                              "journal_result": journal.get("result"), "competitor_rows_after_search": len(stored)})
            (OUT / "web-search-answer.md").write_text(answer["text"] + "\n\nSources:\n" + "\n".join(f"{i + 1}. {s['title']} - {s['uri']}" for i, s in enumerate(answer["sources"])), encoding="utf8")

        if "captions" in steps or "images" in steps:
            images = "images" in steps
            job = call("POST", root + "/content-generations", {"request_key": str(uuid4()), "platforms": ["LinkedIn"], "content_type": "educational",
                                                                "topic": "How a custom AI assistant can sort incoming support tickets", "objective": "educational",
                                                                "include_images": images, "aspect_ratios": {"LinkedIn": "4:5"},
                                                                "image_options": {"visual_style": "editorial"}}).json()
            text = wait(root + f"/content-generations/{job['id']}")
            if text["status"] != "completed":
                record("captions", {"status": text["status"], "error": text.get("error_code")}, False)
            result = call("GET", root + f"/content-generations/{job['id']}/result").json()
            post = result["posts"][0]
            record("captions", {"model": text.get("model_identifier"), "usage": text.get("token_usage"), "meta": result["generation_meta"],
                                "title": post["title"], "hook": post["hook"], "caption": post["caption"], "hashtags": post["hashtags"],
                                "cta": post["call_to_action"], "image_brief_chars": len(post["image_prompt"]), "warnings": result.get("warnings"),
                                "quality": {c["id"]: c["status"] for c in result["quality"][0]["checks"]}})
            saved = None
            if images:
                for image_job in result.get("image_jobs", []):
                    wait(f"{root}/ai-jobs/{image_job['job_id']}")
                media = call("GET", root + f"/content-generations/{job['id']}/media").json()
                if any(j["status"] != "completed" for j in media["jobs"]):
                    record("image_generation", {"jobs": [(j["status"], j["error_code"]) for j in media["jobs"]]}, False)
            saved = call("POST", root + "/posts", {**post, "creation_key": str(uuid4()), "generation_job_id": job["id"], "result_index": 0}).json()
            if images:
                approved = call("POST", root + f"/posts/{saved['id']}/approve", {"revision": call("GET", root + f"/posts/{saved['id']}").json()["revision"]}).json()
                edit = call("POST", root + f"/posts/{saved['id']}/images", {"request_key": str(uuid4()), "operation": "background", "options": {"background": "light"}}).json()
                edited = wait(root + f"/ai-jobs/{edit['id']}")
                if edited["status"] != "completed":
                    record("image_edit", {"status": edited["status"], "error": edited.get("error_code")}, False)
                after = call("GET", root + f"/posts/{saved['id']}").json()
                report["approval_invalidation"] = {"before": approved["status"], "after_edit": after["status"]}
                for asset in sorted(call("GET", root + f"/posts/{saved['id']}/assets").json(), key=lambda a: a["created_at"]):
                    raw = call("GET", root + f"/media/{asset['id']}?download=true").content
                    with Image.open(io.BytesIO(raw)) as im:
                        size = im.size
                    name = f"openai-{asset['generation_mode']}-{asset['aspect_ratio'].replace(':', 'x')}.png"
                    (OUT / name).write_bytes(raw)
                    record(f"image_{asset['generation_mode']}", {"file": name, "pixels": size, "aspect": asset["aspect_ratio"], "parent": bool(asset["parent_asset_id"]),
                                                                  "quality": asset["quality_status"], "duration_ms": asset["duration_ms"],
                                                                  "checks": {c["id"]: c["status"] for c in (asset["quality_report"] or {}).get("checks", [])}})
            # Post saving and retrieval (no AI call).
            again = call("GET", root + f"/posts/{saved['id']}").json()
            record("post_save_retrieve", {"post_id": saved["id"], "status": again["status"], "caption_matches": again["caption"] == post["caption"],
                                          "primary_asset": bool(again.get("primary_asset_id"))})
        (OUT / "live-report.json").write_text(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
