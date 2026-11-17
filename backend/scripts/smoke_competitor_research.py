"""Opt-in live competitor research smoke. Retains its smoke account/company/records.

From backend/: python scripts/smoke_competitor_research.py --run-live --max-competitors 3

Uses the real API for bulk add + bulk research admission, then processes ONLY this
company's queued research jobs in-process with the current code (company-scoped
claim), so a separately running shared worker on older code cannot be mistaken for
this code path. Each competitor: one secure website fetch (<=5 pages, robots
respected) plus at most two extraction and two assessment Gemini text calls.
No search/grounding and no image requests. Never prints credentials.
"""
import argparse
import asyncio
import secrets
import sys
from pathlib import Path
from uuid import uuid4
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.services.gemini_brand_analyzer import GeminiBrandAnalyzer
from app.services import ai_queue
from app.db.database import SessionLocal
from app.models import user, content, brand_extraction  # noqa: F401 register related models
from app.workers.intelligence import run_job

# Independently chosen public software-consultancy websites (not grounded search output).
COMPETITORS = [
    {"name": "Atomic Object", "website_url": "https://atomicobject.com"},
    {"name": "8th Light", "website_url": "https://8thlight.com"},
    {"name": "Sparkbox", "website_url": "https://sparkbox.com"},
]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-live", action="store_true")
    parser.add_argument("--max-competitors", type=int, default=0)
    args = parser.parse_args()
    if not args.run_live or not 1 <= args.max_competitors <= 3:
        parser.error("Explicit --run-live --max-competitors 1..3 required")
    if settings.GEMINI_MODEL != "gemini-2.5-flash":
        parser.error("Review pricing and budget for the configured model first")
    picked = COMPETITORS[: args.max_competitors]
    with httpx.Client(base_url="http://localhost:8000/api/v1", headers={"Origin": "http://localhost:3000"}, timeout=30) as client:
        def call(method, path, data=None):
            response = client.request(method, path, json=data)
            if response.is_error:
                raise RuntimeError(f"Smoke API HTTP {response.status_code}: {response.text[:300]}")
            return response.json()
        password = "Smoke123!" + secrets.token_urlsafe(24)
        email = f"competitor-smoke-{uuid4().hex}@example.com"
        call("POST", "/auth/register", {"full_name": "Competitor Smoke", "email": email, "password": password})
        call("POST", "/auth/login", {"email": email, "password": password})
        workspace = call("POST", "/workspaces", {"name": "Live competitor smoke"})
        company = call("POST", f"/workspaces/{workspace['id']}/companies", {"name": "Example Engineering", "industry": "Software development", "description": "Custom software design and engineering for growing product teams."})
        root = f"/companies/{company['id']}"
        brand = call("GET", root + "/brand")
        call("PATCH", root + "/brand", {"revision": brand["revision"], "display_name": "Example Engineering", "description": "Custom software design and engineering for growing product teams.",
                                        "products_services": ["Custom software development", "Product design"], "target_audience": "Startups and product teams", "brand_voice": ["Clear"]})
        brand = call("GET", root + "/brand"); call("POST", root + "/brand/confirm", {"revision": brand["revision"]})
        bulk = call("POST", root + "/competitors/bulk", {"request_key": str(uuid4()), "research": True, "competitors": picked})
        print({"company_id": company["id"], "saved": [i["status"] for i in bulk["items"]], "batch_total": (bulk["batch"] or {}).get("total"), "research_error": bulk["research_error"]}, flush=True)
        batch_id = bulk["batch"]["batch_id"]
        # Claim every job for this company immediately, then research them concurrently.
        claims = []
        for _ in range(len(picked)):
            with SessionLocal() as db:
                claimed = ai_queue.claim(db, company_id=company["id"])
            if claimed:
                claims.append(claimed)
        processed = len(claims)
        analyzer = GeminiBrandAnalyzer()
        try:
            await asyncio.gather(*(run_job(c, analyzer) for c in claims))
        finally:
            await analyzer.close()
        batch = call("GET", root + f"/competitor-research-batches/{batch_id}")
        print({"processed_in_process": processed, "batch": {k: batch[k] for k in ("total", "completed", "failed", "queued", "running")},
               "errors": [j["error_code"] for j in batch["jobs"] if j["error_code"]]}, flush=True)
        rows = call("GET", root + "/competitors")
        insights = call("GET", root + "/competitor-insights")
        for row in rows:
            found = next((i for i in insights if i["competitor_id"] == row["id"]), None)
            data = (found or {}).get("data", {})
            print({"competitor": row["name"], "verification": row["verification_status"], "relevance": row["relevance_score"],
                   "research_status": (row["research_job"] or {}).get("status"), "assessment": data.get("assessment_status"),
                   "services": len(data.get("products_services") or []), "themes": len(data.get("content_themes") or []),
                   "strengths": len(data.get("strengths") or []), "opportunities": len(data.get("content_opportunities") or []),
                   "positioning": bool(data.get("market_positioning")), "evidence": len((found or {}).get("source_evidence") or [])}, flush=True)
        researched = [r for r in rows if r["verification_status"] in ("verified", "partially_verified")]
        if researched:
            target = researched[0]
            call("PATCH", root + f"/competitors/{target['id']}", {"revision": target["revision"], "selection_status": "approved"})
            from app.services.content_generation import context_for
            from app.models.onboarding import Company
            with SessionLocal() as db:
                context = context_for(db, db.get(Company, company["id"]))
            print({"approved": target["name"], "generation_context_competitors": [i["name"] for i in context["competitor_insights"]],
                   "context_has_opportunities": bool(context["competitor_insights"] and context["competitor_insights"][0]["opportunities"])}, flush=True)
        # Persistence across a fresh login session.
        client.cookies.clear()
        call("POST", "/auth/login", {"email": email, "password": password})
        print({"after_relogin_competitors": len(call("GET", root + "/competitors")), "after_relogin_insights": len(call("GET", root + "/competitor-insights"))}, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
