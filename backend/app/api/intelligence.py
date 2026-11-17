import asyncio
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Query
from sqlalchemy import select
from app.api.auth import current_user
from app.api.onboarding import storage,request_policy
from app.core.permissions import company_access
from app.core.intelligence_config import ai_settings
from app.models.intelligence import AIJob,Competitor,CompetitorResearch
from uuid import uuid5
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import distinct_on
from app.schemas.intelligence import (JobRequest,AIJobResponse,CompetitorCreate,CompetitorUpdate,CompetitorResponse,ResearchResponse,
    RevisionOnly,ResearchRequest,BulkCompetitorCreate,BulkResearchRequest,BatchResponse,BulkCreateResponse,BulkItemResult)
from app.services import ai_queue,competitor_intelligence as service
from app.services.onboarding import transaction
from app.services.extraction_jobs import now
from app.services import gemini_search
from app.services.extraction_errors import ExtractionError

router=APIRouter(prefix="/companies/{company_id}",tags=["Competitor intelligence"],dependencies=[Depends(request_policy)])


def competitor_access(db,company_id,competitor_id):
    row=db.scalar(select(Competitor).where(Competitor.company_id==company_id,Competitor.id==competitor_id))
    if not row:raise HTTPException(404,"Competitor not found")
    return row


def job_access(db,company_id,job_id,kind=None):
    row=db.scalar(select(AIJob).where(AIJob.company_id==company_id,AIJob.id==job_id))
    if not row or (kind and row.kind!=kind):raise HTTPException(404,"Job not found")
    return row


@router.get("/ai-capabilities")
def capabilities(company_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    available = gemini_search.configured() if ai_settings.search_provider == "gemini" else gemini_search.brave_enabled()
    return {"search_available": available, "search_provider": ai_settings.search_provider,
            "search_mode": "display_only" if ai_settings.search_provider == "gemini" else "licensed_persistence",
            "search_state": "configured_requires_model_access" if available else "search_provider_not_configured",
            "brave_discovery_available": gemini_search.brave_enabled(),
            "image_available":bool(ai_settings.gemini_image_model),"image_state":"configured_requires_model_access" if ai_settings.gemini_image_model else "image_provider_not_configured"}


@router.post("/competitor-search", response_model=gemini_search.GroundedAnswer)
async def grounded_search(company_id:UUID, data:JobRequest, user=Depends(current_user), db=Depends(storage)):
    company = company_access(db, user, company_id, True)
    context = service.brand_context(company)
    if not gemini_search.configured():
        raise HTTPException(503, "search_provider_not_configured: Configure Gemini or use independent manual research.")
    request_id = gemini_search.begin_request(db, company, user, data.request_key, context)
    # begin_request commits and releases all database locks before network I/O.
    provider = gemini_search.GeminiGroundedSearchProvider()
    try:
        answer = await provider.search(context)
    except BaseException as exc:
        error = exc if isinstance(exc, ExtractionError) else ExtractionError("search_unavailable", "Google Search could not complete. Use independent manual research or try later.")
        gemini_search.finish_request(db, request_id, provider.usage, error)
        if isinstance(exc, (KeyboardInterrupt, SystemExit, asyncio.CancelledError)):
            raise
        status = 429 if error.code == "search_rate_limited" else 502
        raise HTTPException(status, f"{error.code}: {error.message}") from None
    if not gemini_search.finish_request(db, request_id, provider.usage):
        raise HTTPException(409, "Search was cancelled or expired. No results were saved.")
    return answer


@router.get("/ai-jobs",response_model=list[AIJobResponse])
def history(company_id:UUID,kind:str|None=None,limit:int=Query(20,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    query=select(AIJob).where(AIJob.company_id==company_id)
    if kind:query=query.where(AIJob.kind==kind)
    return db.scalars(query.order_by(AIJob.created_at.desc()).limit(limit).offset(offset)).all()


@router.get("/ai-jobs/{job_id}",response_model=AIJobResponse)
def job_status(company_id:UUID,job_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);return job_access(db,company_id,job_id)


@router.post('/ai-jobs/{job_id}/cancel',response_model=AIJobResponse)
def cancel(company_id:UUID,job_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id,True)
    job=db.scalar(select(AIJob).where(AIJob.company_id==company_id,AIJob.id==job_id).with_for_update())
    if not job:raise HTTPException(404,'Job not found')
    if job.status in ('queued','running'):
        with transaction(db):
            job.status=job.stage='cancelled';job.completed_at=now();job.lease_token=job.lease_expires_at=None
    return job


@router.post("/competitor-discoveries",response_model=AIJobResponse,status_code=202)
def discover(company_id:UUID,data:JobRequest,user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True)
    context=service.brand_context(company)
    if not gemini_search.brave_enabled():raise HTTPException(503,"search_provider_not_configured: Persistent automatic discovery is disabled. Use display-only Gemini search or independent manual entry; Brave requires a licensed configuration.")
    return ai_queue.enqueue(db,company,user,"competitor_discovery",data.request_key,{"context":context,"provider":"brave"})


@router.get("/competitor-discoveries/{job_id}",response_model=AIJobResponse)
def discovery_status(company_id:UUID,job_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id);return job_access(db,company_id,job_id,"competitor_discovery")


def with_research_state(db,company_id,rows):
    """Attach each competitor's latest research job and last successful research time (two bounded queries)."""
    ids=[str(r.id) for r in rows]
    jobs={};researched={}
    if ids:
        for job in db.scalars(select(AIJob).where(AIJob.company_id==company_id,AIJob.kind=="competitor_research",AIJob.target_key.in_(ids)).order_by(AIJob.target_key,AIJob.created_at.desc()).ext(distinct_on(AIJob.target_key))):
            jobs[job.target_key]=job
        for competitor_id,last in db.execute(select(CompetitorResearch.competitor_id,func.max(CompetitorResearch.created_at)).where(CompetitorResearch.company_id==company_id,CompetitorResearch.competitor_id.in_([r.id for r in rows])).group_by(CompetitorResearch.competitor_id)):
            researched[str(competitor_id)]=last
    return [CompetitorResponse.model_validate(r).model_copy(update={"research_job":AIJobResponse.model_validate(jobs[str(r.id)]) if str(r.id) in jobs else None,"last_researched_at":researched.get(str(r.id))}) for r in rows]


def research_payload(company,competitor):
    return {"context":service.brand_context(company),"competitor":{"id":str(competitor.id),"name":competitor.name,"website_url":competitor.website_url}}


def batch_from(batch_id,jobs):
    count=lambda status:sum(1 for j in jobs if j.status==status)
    return BatchResponse(batch_id=batch_id,total=len(jobs),queued=count("queued"),running=count("running"),completed=count("completed"),failed=count("failed"),cancelled=count("cancelled"),jobs=[AIJobResponse.model_validate(j) for j in jobs])


def queue_research(db,company,user,competitors,request_key,force):
    if len(competitors)>ai_settings.max_bulk_research:raise HTTPException(422,f"Research at most {ai_settings.max_bulk_research} competitors at once")
    if any(c.removed_at is not None for c in competitors):raise HTTPException(422,"Restore removed competitors before researching them")
    items=[(uuid5(request_key,str(c.id)),str(c.id),research_payload(company,c)) for c in competitors]
    jobs=ai_queue.enqueue_many(db,company,user,"competitor_research",items,request_key,force)
    # Reused active/cached jobs keep their original batch id; the response reports every job for this request.
    return batch_from(request_key,jobs)


@router.get("/competitors",response_model=list[CompetitorResponse])
def competitors(company_id:UUID,include_removed:bool=False,limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    query=select(Competitor).where(Competitor.company_id==company_id)
    if not include_removed:query=query.where(Competitor.removed_at.is_(None))
    rows=db.scalars(query.order_by(Competitor.created_at,Competitor.id).limit(limit).offset(offset)).all()
    return with_research_state(db,company_id,rows)


@router.post("/competitors",response_model=CompetitorResponse,status_code=201)
def add(company_id:UUID,data:CompetitorCreate,user=Depends(current_user),db=Depends(storage)):
    return service.add_manual(db,company_access(db,user,company_id,True),data)


@router.post("/competitors/bulk",response_model=BulkCreateResponse)
def bulk_add(company_id:UUID,data:BulkCompetitorCreate,user=Depends(current_user),db=Depends(storage)):
    """Save several independently sourced websites; invalid rows are reported individually, not fatal."""
    company=company_access(db,user,company_id,True)
    if data.research:service.brand_context(company)
    items=[];saved=[];seen=set()
    for row in data.competitors:
        try:
            parsed=CompetitorCreate(name=row.name,website_url=row.website_url)
            key=service.domain(parsed.website_url)
            if key in seen:raise HTTPException(422,"Duplicate website in this list")
            seen.add(key)
            before=db.scalar(select(Competitor).where(Competitor.company_id==company.id,Competitor.normalized_domain==key))
            was_removed=bool(before and before.removed_at is not None)
            record=service.add_manual(db,company,parsed)
            status="restored" if was_removed else "existing" if before else "created"
            items.append(BulkItemResult(name=row.name,website_url=row.website_url,status=status,competitor=CompetitorResponse.model_validate(record)))
            saved.append(record)
        except HTTPException as exc:
            items.append(BulkItemResult(name=row.name,website_url=row.website_url,status="invalid",error=str(exc.detail)))
        except ValidationError as exc:
            message="; ".join(str(e.get("msg","Invalid value")).removeprefix("Value error, ") for e in exc.errors())[:300]
            items.append(BulkItemResult(name=row.name,website_url=row.website_url,status="invalid",error=message or "Invalid competitor"))
        except ExtractionError as exc:
            items.append(BulkItemResult(name=row.name,website_url=row.website_url,status="invalid",error=exc.message))
    batch=None;research_error=None
    if data.research and saved:
        try:batch=queue_research(db,company,user,saved,data.request_key,False)
        except HTTPException as exc:
            # Saved competitors are kept; research can be retried explicitly.
            research_error=str(exc.detail)
    return BulkCreateResponse(items=items,batch=batch,research_error=research_error)


@router.post("/competitors/research-batch",response_model=BatchResponse,status_code=202)
def bulk_research(company_id:UUID,data:BulkResearchRequest,user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True)
    ids=list(dict.fromkeys(data.competitor_ids))
    rows={r.id:r for r in db.scalars(select(Competitor).where(Competitor.company_id==company_id,Competitor.id.in_(ids)))}
    if len(rows)!=len(ids):raise HTTPException(404,"Competitor not found")
    return queue_research(db,company,user,[rows[i] for i in ids],data.request_key,data.force)


@router.get("/competitor-research-batches/{batch_id}",response_model=BatchResponse)
def batch_status(company_id:UUID,batch_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    jobs=db.scalars(select(AIJob).where(AIJob.company_id==company_id,AIJob.batch_id==batch_id).order_by(AIJob.created_at,AIJob.id)).all()
    if not jobs:raise HTTPException(404,"Batch not found")
    return batch_from(batch_id,jobs)


@router.get("/competitors/{competitor_id}",response_model=CompetitorResponse)
def detail(company_id:UUID,competitor_id:UUID,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    return with_research_state(db,company_id,[competitor_access(db,company_id,competitor_id)])[0]


@router.patch("/competitors/{competitor_id}",response_model=CompetitorResponse)
def edit(company_id:UUID,competitor_id:UUID,data:CompetitorUpdate,user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True)
    return service.edit_competitor(db,company,competitor_access(db,company_id,competitor_id),data)


@router.post("/competitors/{competitor_id}/remove",response_model=CompetitorResponse)
def remove(company_id:UUID,competitor_id:UUID,data:RevisionOnly,user=Depends(current_user),db=Depends(storage)):
    """Soft removal: research history and evidence are retained; removed rows never inform generation."""
    company_access(db,user,company_id,True)
    return service.set_removed(db,competitor_access(db,company_id,competitor_id),data.revision,True)


@router.post("/competitors/{competitor_id}/restore",response_model=CompetitorResponse)
def restore(company_id:UUID,competitor_id:UUID,data:RevisionOnly,user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id,True)
    return service.set_removed(db,competitor_access(db,company_id,competitor_id),data.revision,False)


@router.post("/competitors/{competitor_id}/research",response_model=AIJobResponse,status_code=202)
def research(company_id:UUID,competitor_id:UUID,data:ResearchRequest,user=Depends(current_user),db=Depends(storage)):
    company=company_access(db,user,company_id,True)
    competitor=competitor_access(db,company_id,competitor_id)
    if competitor.removed_at is not None:raise HTTPException(422,"Restore the competitor before researching it")
    return ai_queue.enqueue(db,company,user,"competitor_research",data.request_key,research_payload(company,competitor),target_key=str(competitor.id),force=data.force)


@router.get("/competitor-insights",response_model=list[ResearchResponse])
def insights(company_id:UUID,competitor_id:UUID|None=None,limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(current_user),db=Depends(storage)):
    company_access(db,user,company_id)
    query=select(CompetitorResearch).where(CompetitorResearch.company_id==company_id)
    if competitor_id:query=query.where(CompetitorResearch.competitor_id==competitor_id)
    return db.scalars(query.order_by(CompetitorResearch.created_at.desc(),CompetitorResearch.id).limit(limit).offset(offset)).all()
