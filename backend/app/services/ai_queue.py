"""Additional typed jobs use the existing PostgreSQL lease/worker architecture."""
from datetime import timedelta
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select, func, text
from app.core.intelligence_config import ai_settings as limits, timeout_for
from app.models.intelligence import AIJob
from app.services.extraction_jobs import now
from app.services.onboarding import transaction

CACHEABLE = ('competitor_discovery', 'competitor_research')


def _check_capacity(db, company, user, new_jobs):
    """Hourly/global admission. Caller must hold the admission advisory lock."""
    for column, value, limit in [(AIJob.company_id, company.id, limits.hourly_company_limit), (AIJob.requested_by, user.id, limits.hourly_user_limit)]:
        used = db.scalar(select(func.count()).select_from(AIJob).where(column == value, AIJob.created_at > now() - timedelta(hours=1)))
        if used + new_jobs > limit:
            remaining = max(0, limit - used)
            raise HTTPException(429, f"AI usage limit reached; {remaining} operation(s) remain this hour. Try later or select fewer items.")
    if db.scalar(select(func.count()).select_from(AIJob).where(AIJob.status.in_(["queued", "running"]))) + new_jobs > limits.max_queue:
        raise HTTPException(503, "AI queue is full; try later")


def _reuse(db, company, kind, key, payload, target_key, force):
    """Return an existing equivalent job, or None when a new job is needed."""
    existing = db.scalar(select(AIJob).where(AIJob.company_id == company.id, AIJob.request_key == key))
    if existing:
        if existing.kind != kind or existing.payload != payload or existing.target_key != target_key:
            raise HTTPException(409, "Creation key belongs to a different AI request")
        return existing
    active = db.scalar(select(AIJob).where(AIJob.company_id == company.id, AIJob.kind == kind, AIJob.target_key == target_key, AIJob.status.in_(["queued", "running"])))
    if active:
        if active.payload == payload or (target_key and kind in CACHEABLE):
            # A queued/running research for the same competitor already covers this request.
            return active
        raise HTTPException(409, "An operation of this type is already running for this company")
    if kind in CACHEABLE and not force:
        cached = db.scalar(select(AIJob).where(AIJob.company_id == company.id, AIJob.kind == kind, AIJob.target_key == target_key, AIJob.status == 'completed', AIJob.payload == payload, AIJob.completed_at > now() - timedelta(hours=24)).order_by(AIJob.completed_at.desc()).limit(1))
        if cached:
            return cached
    return None


def enqueue(db, company, user, kind, key, payload, target_key="", batch_id=None, force=False, extra_capacity=0):
    """extra_capacity reserves room for follow-up jobs the worker will create (e.g. images)."""
    reused = _reuse(db, company, kind, key, payload, target_key, force)
    if reused:
        return reused
    db.execute(text("SELECT pg_advisory_xact_lock(560001)"))
    _check_capacity(db, company, user, 1 + extra_capacity)
    job = AIJob(company_id=company.id, requested_by=user.id, kind=kind, request_key=key, payload=payload, target_key=target_key, batch_id=batch_id)
    with transaction(db): db.add(job)
    return job


def enqueue_many(db, company, user, kind, items, batch_id, force=False):
    """Atomically admit several targeted jobs. items: [(request_key, target_key, payload)].

    Either every new job is admitted or none is; reused/cached jobs do not consume capacity.
    """
    results, pending = [], []
    for key, target_key, payload in items:
        reused = _reuse(db, company, kind, key, payload, target_key, force)
        results.append(reused)
        if not reused:
            pending.append(len(results) - 1)
    if pending:
        db.execute(text("SELECT pg_advisory_xact_lock(560001)"))
        _check_capacity(db, company, user, len(pending))
        with transaction(db):
            for index in pending:
                key, target_key, payload = items[index]
                job = AIJob(company_id=company.id, requested_by=user.id, kind=kind, request_key=key, payload=payload, target_key=target_key, batch_id=batch_id)
                db.add(job)
                results[index] = job
    return results


def claim(db, company_id=None):
    scope = [AIJob.company_id == company_id] if company_id else []
    for job in db.scalars(select(AIJob).where(AIJob.status == "running", AIJob.lease_expires_at < now(), *scope).with_for_update(skip_locked=True)):
        job.duration_ms += int((now() - job.started_at).total_seconds() * 1000)
        job.lease_token = job.lease_expires_at = None
        if (job.kind == "competitor_discovery" and job.payload.get("mode") == "display_only") or job.attempt_count >= limits.max_attempts or job.duration_ms >= timeout_for(job.kind) * 1000:
            job.status = job.stage = "failed"; job.error_code = "worker_interrupted"; job.error_message = "The worker was interrupted. Retry this operation."; job.completed_at = now()
        else: job.status = job.stage = "queued"; job.available_at = now() + timedelta(seconds=5)
    db.flush()
    job = db.scalar(select(AIJob).where(AIJob.status == "queued", AIJob.available_at <= now(), *scope).order_by(AIJob.created_at).with_for_update(skip_locked=True).limit(1))
    if not job: db.commit(); return None
    job.status = "running"; job.stage = "preparing"; job.attempt_count += 1; job.started_at = now(); job.lease_token = uuid4(); job.lease_expires_at = now() + timedelta(seconds=timeout_for(job.kind) + 20)
    job.error_code = job.error_message = None
    claim = (job.id, job.lease_token)
    db.commit(); return claim


def leased(db, job_id, token):
    return db.scalar(select(AIJob).where(AIJob.id == job_id, AIJob.lease_token == token, AIJob.status == "running", AIJob.lease_expires_at > now()).with_for_update())


def stage(db, job_id, token, value):
    """Progress marker; a lost lease silently ignores the update."""
    job = leased(db, job_id, token)
    if job:
        job.stage = value
    db.commit()


def fail(db, job_id, token, error):
    job = leased(db, job_id, token)
    if not job: return
    job.error_code, job.error_message = error.code, error.message
    job.duration_ms += int((now() - job.started_at).total_seconds() * 1000)
    job.lease_token = job.lease_expires_at = None
    if error.transient and job.attempt_count < limits.max_attempts and job.duration_ms < timeout_for(job.kind) * 1000 - 5000:
        job.status = job.stage = "queued"; job.available_at = now() + timedelta(seconds=5 * job.attempt_count)
    else: job.status = job.stage = "failed"; job.completed_at = now()
    db.commit()
