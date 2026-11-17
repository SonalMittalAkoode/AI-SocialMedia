"""Attach one clearly labelled completed research fixture to a competitor; never calls a provider.

Only accepts the isolated e2e-* test accounts created by the browser test helper.
Usage from backend/: python scripts/seed_competitor_research_fixture.py COMPANY USER COMPETITOR
"""
import json
import sys
from datetime import datetime, timezone
from uuid import UUID, uuid4
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app  # noqa: F401; register existing models
from app.db.database import SessionLocal
from app.models.user import User
from app.models.intelligence import AIJob, Competitor, CompetitorResearch
from app.core.permissions import company_access

FIXTURE_MODEL = "browser-test-fixture-no-provider"


def main():
    company_id, user_id, competitor_id = map(UUID, sys.argv[1:4])
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if not user or not (user.email.startswith("e2e-") and user.email.endswith("@example.com")):
            raise SystemExit("Only isolated browser-test accounts can use this fixture")
        company_access(db, user, company_id, True)
        competitor = db.query(Competitor).filter_by(id=competitor_id, company_id=company_id).one()
        url = competitor.website_url
        data = {
            "business": {"company_name": competitor.name, "description": "Fixture: a coffee roaster selling single-origin beans online.", "industry": "Coffee", "business_type": "Roaster", "city": None, "country": None, "tagline": None},
            "products_services": ["Single-origin beans", "Brewing workshops"],
            "target_audience": ["Home brewers"],
            "market_positioning": "Fixture interpretation: positions itself as an approachable specialty roaster.",
            "content_themes": ["Origin stories", "Brewing guides"],
            "strengths": [{"observation": "Clear specialty offer", "basis": "Single-origin beans", "classification": "interpretation"}],
            "content_opportunities": [{"suggestion": "Show your roasting process step by step", "rationale": "Differentiates on transparency", "classification": "strategic_suggestion"}],
            "fit": {"score": 70, "rationale": "Fixture rationale."}, "lexical_relevance": 40, "assessment_status": "completed",
            "potential_gaps": [], "metrics": {"engagement_rate": None, "followers": None, "posting_frequency": None},
            "warnings": ["Browser test fixture; no website or AI provider was called."],
            "analysis": {"company_name": competitor.name, "products_services": ["Single-origin beans", "Brewing workshops"]},
        }
        evidence = [{"field": "products_services", "value": "Single-origin beans", "classification": "explicit", "confidence": "high", "source_url": url, "supporting_text": "Fixture passage: Single-origin beans"}]
        job = AIJob(company_id=company_id, requested_by=user.id, kind="competitor_research", request_key=uuid4(), target_key=str(competitor.id),
                    status="completed", stage="completed", model_identifier=FIXTURE_MODEL, completed_at=datetime.now(timezone.utc),
                    payload={"fixture": True, "competitor": {"id": str(competitor.id)}}, result={"competitor_id": str(competitor.id)})
        db.add(job); db.flush()
        db.add(CompetitorResearch(company_id=company_id, competitor_id=competitor.id, job_id=job.id, data=data, source_evidence=evidence, model_identifier=FIXTURE_MODEL))
        competitor.verification_status = "verified"; competitor.relevance_score = 58; competitor.relevance_reason = "Fixture relevance; not a provider result."
        db.commit()
        print(json.dumps({"job_id": str(job.id)}))


if __name__ == "__main__":
    main()
