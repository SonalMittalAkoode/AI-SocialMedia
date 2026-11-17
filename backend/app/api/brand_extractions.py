from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from app.api.auth import current_user
from app.api.onboarding import request_policy, storage
from app.core.permissions import company_access
from app.models.brand_extraction import BrandExtractionJob as Job, BrandExtractionResult as Result
from app.schemas.brand_extraction import StartExtraction, JobResponse, ResultResponse, ApplyFindings
from app.services import extraction_jobs as service

router = APIRouter(prefix="/companies/{company_id}/brand-extractions", tags=["Brand extraction"], dependencies=[Depends(request_policy)])


def job_access(db, company_id, job_id):
    job = db.scalar(select(Job).where(Job.id == job_id, Job.company_id == company_id))
    if not job:
        raise HTTPException(404, "Analysis not found")
    return job


@router.post("", status_code=202, response_model=JobResponse)
def start(company_id: UUID, data: StartExtraction, user=Depends(current_user), db=Depends(storage)):
    company = company_access(db, user, company_id, True)
    return service.start(db, company, user, data)


@router.get("", response_model=list[JobResponse])
def history(company_id: UUID, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100), user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id)
    return db.scalars(select(Job).where(Job.company_id == company_id).order_by(Job.created_at.desc(), Job.id.desc()).offset(offset).limit(limit)).all()


@router.get("/{job_id}", response_model=JobResponse)
def status(company_id: UUID, job_id: UUID, user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id)
    return job_access(db, company_id, job_id)


@router.get("/{job_id}/result", response_model=ResultResponse)
def result(company_id: UUID, job_id: UUID, user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id)
    job = job_access(db, company_id, job_id)
    if job.status in {"queued", "running"}:
        raise HTTPException(409, "Analysis is still processing")
    if job.status in {"failed", "cancelled"}:
        raise HTTPException(422, job.error_message or "Analysis did not complete")
    result = db.scalar(select(Result).where(Result.job_id == job.id, Result.company_id == company_id))
    if not result:
        raise HTTPException(404, "Analysis result unavailable")
    return result


@router.post("/{job_id}/apply")
def apply(company_id: UUID, job_id: UUID, data: ApplyFindings, user=Depends(current_user), db=Depends(storage)):
    company = company_access(db, user, company_id, True)
    job = job_access(db, company_id, job_id)
    if job.status != "completed":
        raise HTTPException(409, "Complete the analysis before applying findings")
    result = db.scalar(select(Result).where(Result.job_id == job.id, Result.company_id == company_id))
    if not result:
        raise HTTPException(404, "Analysis result unavailable")
    return service.apply(db, company, result, data)
