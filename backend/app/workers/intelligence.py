"""Typed handlers dispatched by the existing extraction worker, using the same DB queue pattern."""
import asyncio
from sqlalchemy import select
from app.db.database import SessionLocal
from app.core.intelligence_config import ai_settings as limits, timeout_for
from app.core.config import settings
from app.models.intelligence import Competitor,CompetitorResearch
from app.services import ai_queue,competitor_intelligence as competitors
from app.services.extraction_jobs import now
from app.services.extraction_errors import ExtractionError


async def run_job(claimed,analyzer,session_factory=SessionLocal,search_provider=None,extractor=None):
    job_id,token=claimed
    with session_factory() as db:
        job=ai_queue.leased(db,job_id,token)
        if not job:return
        kind,payload,company_id,remaining=job.kind,job.payload,job.company_id,max(0.1,timeout_for(job.kind)-job.duration_ms/1000)
        job.stage={'competitor_discovery':'searching','competitor_research':'researching','content_generation':'generating','image_generation':'generating_image'}[kind]
        if kind in ('competitor_research','content_generation'):job.model_identifier=settings.GEMINI_MODEL
        elif kind=='image_generation':job.model_identifier=limits.gemini_image_model
        db.commit()
    try:
        async with asyncio.timeout(remaining):
            if kind=="competitor_discovery":
                if payload.get("mode") == "display_only":
                    raise ExtractionError("search_display_only", "Live Gemini searches are never replayed by the background worker.")
                rows=await competitors.discover(payload["context"],search_provider)
                result={"query_count":len(__import__('app.services.search_provider',fromlist=['queries_for']).queries_for(payload["context"])),"candidate_count":len(rows),"verified_count":0,"warnings":["Search candidates are unverified until public website research succeeds."]}
                with session_factory() as db:
                    job=ai_queue.leased(db,job_id,token)
                    if not job:return
                    for row in rows:
                        existing=db.scalar(select(Competitor).where(Competitor.company_id==company_id,Competitor.normalized_domain==row["normalized_domain"]))
                        if not existing:db.add(Competitor(company_id=company_id,**row))
                    complete(job,result);db.commit()
            elif kind=="competitor_research":
                kwargs={"extractor":extractor} if extractor else {}
                def stage(value):
                    with session_factory() as db:ai_queue.stage(db,job_id,token,value)
                result,usage=await competitors.research(payload["competitor"],payload["context"],analyzer,stage=stage,**kwargs)
                with session_factory() as db:
                    job=ai_queue.leased(db,job_id,token)
                    if not job:return
                    record=db.scalar(select(Competitor).where(Competitor.company_id==company_id,Competitor.id==payload["competitor"]["id"]).with_for_update())
                    if not record or record.removed_at is not None:raise ExtractionError("competitor_unavailable","The competitor was removed before research finished")
                    if competitors.domain(payload["competitor"]["website_url"])!=record.normalized_domain:raise ExtractionError("competitor_changed","The competitor website changed during research. Research it again.")
                    record.verification_status=result["verification_status"];record.relevance_score=result["relevance_score"];record.relevance_reason=result["relevance_reason"]
                    # Preserve manually edited identity/description and approval status.
                    db.add(CompetitorResearch(company_id=company_id,competitor_id=record.id,job_id=job_id,data=result,source_evidence=result["analysis"]["field_evidence"],model_identifier=settings.GEMINI_MODEL))
                    job.model_identifier=settings.GEMINI_MODEL;job.token_usage=usage
                    complete(job,{"competitor_id":str(record.id),"verification_status":record.verification_status});db.commit()
            else:
                from app.services.content_handlers import handle_content_job
                await handle_content_job(claimed,analyzer,session_factory)
    except Exception as exc:
        error=exc if isinstance(exc,ExtractionError) else ExtractionError("job_timeout" if isinstance(exc,TimeoutError) else "worker_failure","The operation could not complete. Retry or use manual entry.",isinstance(exc,TimeoutError))
        with session_factory() as db:ai_queue.fail(db,job_id,token,error)


def complete(job,result):
    job.result=result;job.status=job.stage="completed";job.completed_at=now()
    job.duration_ms+=int((now()-job.started_at).total_seconds()*1000)
    job.lease_token=job.lease_expires_at=None
