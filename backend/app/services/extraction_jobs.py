"""PostgreSQL is both durable queue and result store: no dual-write dispatch gap."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select, func

from app.core.extraction_config import extraction_settings as limits
from app.models.brand_extraction import BrandExtractionJob as Job, BrandExtractionResult as Result
from app.services import onboarding
from app.schemas.brand_extraction import adapt_approved


def now():
    return datetime.now(timezone.utc)


def start(db, company, user, data):
    # API holds the company row lock: duplicate starts and per-company quota are serialized.
    active = db.scalar(select(Job).where(Job.company_id == company.id, Job.status.in_(["queued", "running"])))
    if active:
        if active.requested_url != data.url:
            raise HTTPException(409, "This company already has a running analysis. Wait for it to finish.")
        return active
    recent = db.scalar(select(Job).where(Job.company_id == company.id, Job.requested_url == data.url, Job.status == "completed", Job.created_at > now() - timedelta(minutes=10)).order_by(Job.created_at.desc()).limit(1))
    if recent and not data.reanalyze:
        return recent
    count = db.scalar(select(func.count()).select_from(Job).where(Job.company_id == company.id, Job.created_at > now() - timedelta(hours=1)))
    if count >= limits.company_hourly_limit:
        raise HTTPException(429, "Company analysis limit reached. Try later or enter details manually.")
    # Serialize queue admission across companies without additional infrastructure.
    db.execute(__import__('sqlalchemy').text("SELECT pg_advisory_xact_lock(480041)"))
    if db.scalar(select(func.count()).select_from(Job).where(Job.requested_by == user.id, Job.created_at > now() - timedelta(hours=1))) >= limits.user_hourly_limit:
        raise HTTPException(429, "Account analysis limit reached. Try later or enter details manually.")
    if db.scalar(select(func.count()).select_from(Job).where(Job.status.in_(["queued", "running"]))) >= limits.max_queue:
        raise HTTPException(503, "Analysis queue is full. Please try later.")
    job = Job(company_id=company.id, requested_by=user.id, requested_url=data.url)
    with onboarding.transaction(db):
        db.add(job)
    return job


def claim(db, company_id=None):
    # Expired leases recover after crashes; old workers cannot publish after reclamation.
    scope = [Job.company_id == company_id] if company_id else []
    stale = db.scalars(select(Job).where(Job.status == "running", Job.lease_expires_at < now(), *scope).with_for_update(skip_locked=True)).all()
    for job in stale:
        elapsed = int((now() - job.started_at).total_seconds() * 1000) if job.started_at else 0
        job.duration_ms = (job.duration_ms or 0) + elapsed
        job.lease_token = None
        job.lease_expires_at = None
        if job.attempt_count >= limits.max_attempts or job.duration_ms >= limits.job_timeout * 1000:
            job.status = job.stage = "failed"
            job.error_code = "worker_interrupted"
            job.error_message = "The worker was interrupted. Please retry the analysis."
            job.completed_at = now()
        else:
            job.status = job.stage = "queued"
            job.available_at = now() + timedelta(seconds=5)
    db.flush()
    job = db.scalar(select(Job).where(Job.status == "queued", Job.available_at <= now(), *scope).order_by(Job.created_at).with_for_update(skip_locked=True).limit(1))
    if not job:
        db.commit()
        return None
    job.status, job.stage = "running", "fetching"
    job.attempt_count += 1
    job.started_at = now()
    job.error_code = job.error_message = None
    job.lease_token = uuid4()
    job.lease_expires_at = now() + timedelta(seconds=limits.job_timeout + 20)
    values = (job.id, job.lease_token, job.requested_url)
    db.commit()
    return values


def leased(db, job_id, token):
    return db.scalar(select(Job).where(Job.id == job_id, Job.status == "running", Job.lease_token == token, Job.lease_expires_at > now()).with_for_update())


def stage(db, job_id, token, value):
    job = leased(db, job_id, token)
    if not job:
        raise RuntimeError("Worker lease lost")
    job.stage = value
    db.commit()


def succeed(db, job_id, token, analysis, website, usage, model, duration):
    job = leased(db, job_id, token)
    if not job:
        return False
    if not db.scalar(select(Result.id).where(Result.job_id == job.id)):
        data = analysis.model_dump(mode="json")
        db.add(Result(job_id=job.id, company_id=job.company_id, extracted_data=data, source_evidence=data["field_evidence"], source_pages=[{"url": p["url"], "title": p["title"], "logo_candidates":p.get("logo_candidates",[]),"style_colors":p.get("style_colors",[])} for p in website["pages"]], warnings=(website["warnings"] + data["warnings"])[:25], token_usage=usage, model_identifier=model))
    job.status = job.stage = "completed"
    job.completed_at = now()
    job.lease_token = job.lease_expires_at = None
    job.page_count, job.duration_ms = len(website["pages"]), duration
    db.commit()
    return True


def fail(db, job_id, token, error):
    job = leased(db, job_id, token)
    if not job:
        return
    job.error_code, job.error_message = error.code, error.message
    elapsed = int((now() - job.started_at).total_seconds() * 1000) if job.started_at else 0
    job.duration_ms = (job.duration_ms or 0) + elapsed
    job.lease_token = job.lease_expires_at = None
    if error.transient and job.attempt_count < limits.max_attempts and job.duration_ms < limits.job_timeout * 1000 - 5000:
        job.status = job.stage = "queued"
        job.available_at = now() + timedelta(seconds=5 * job.attempt_count)
    else:
        job.status = job.stage = "failed"
        job.completed_at = now()
    db.commit()


def apply(db, company, result, data):
    onboarding.check_revision(company, data.company_revision)
    onboarding.check_revision(company.brand, data.brand_revision)
    try:
        company_data, brand_data = adapt_approved(data, company.brand.content_guidelines)
    except ValueError:
        raise HTTPException(422, "Selected fields are not compatible with the brand profile. Check the field values.") from None
    # Only fields actually offered in this result may be approved, with user edits.
    if any(result.extracted_data.get(k) in (None, [], {}, "") for k in data.fields):
        raise HTTPException(422, "Select available findings from this analysis")
    with onboarding.transaction(db):
        changed_company = onboarding.assign(company, company_data)
        changed_brand = onboarding.assign(company.brand, brand_data)
        if changed_company or changed_brand:
            company.brand.source = "ai"
            company.brand.is_confirmed = False
            company.brand.confirmed_at = None
            if "brand" in company.onboarding.completed_steps:
                onboarding.invalidate(company, "brand")
    return {"company_revision": company.revision, "brand_revision": company.brand.revision}
