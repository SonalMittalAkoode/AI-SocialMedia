"""Simplified setup reuses the existing company, extraction and generation records."""
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.core.intelligence_config import ai_settings
from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult
from app.models.content import Post
from app.models.intelligence import AIJob, Competitor
from app.models.scheduling import PostSchedule
from app.models.social_accounts import SocialAccount
from app.schemas.brand_extraction import ApplyFindings
from app.schemas.content import GenerationRequest
from app.schemas.onboarding import FirstPostHandoff
from app.services import ai_provider, ai_queue, extraction_jobs, onboarding
from app.services.brand_provenance import website_host
from app.services.content_generation import context_for

PLATFORMS = {"instagram": "Instagram", "linkedin": "LinkedIn", "facebook": "Facebook", "x": "X"}
OBJECTIVES = {"lead_generation": "promotion", "audience_engagement": "engagement"}
REVIEW_FIELDS = (
    "industry", "business_type", "city", "state", "country",
    "public_email", "public_phone", "office_address",
)
BRAND_FIELDS = ("products_services", "target_audience", "brand_voice", "brand_keywords", "social_links")
GUIDELINES = ("value_proposition", "content_pillars", "suggested_content_tone")


def prepare_website_brand(db, company, job_id):
    job = db.scalar(select(BrandExtractionJob).where(
        BrandExtractionJob.id == job_id, BrandExtractionJob.company_id == company.id,
    ))
    if not job or not website_host(company.website_url) or job.requested_url != company.website_url:
        raise HTTPException(404, "Analysis for the current website was not found")
    if job.status != "completed":
        raise HTTPException(409, "Website analysis is still pending")
    if company.brand.is_confirmed:
        return
    result = db.scalar(select(BrandExtractionResult).where(
        BrandExtractionResult.job_id == job.id, BrandExtractionResult.company_id == company.id,
    ))
    if not result:
        raise HTTPException(404, "Completed website findings are unavailable")
    brand, data = company.brand, result.extracted_data
    fields = {key: data[key] for key in REVIEW_FIELDS if data.get(key) and not getattr(company, key)}
    fields.update({key: data[key] for key in BRAND_FIELDS if data.get(key) and not getattr(brand, key)})
    if data.get("company_name") and company.name == website_host(company.website_url) and brand.display_name == company.name:
        fields["company_name"] = data["company_name"]
    if data.get("description") and not (brand.description or company.description):
        fields["description"] = data["description"]
    if data.get("tagline") and not brand.tagline:
        fields["tagline"] = data["tagline"]
    if not brand.content_guidelines:
        fields.update({key: data[key] for key in GUIDELINES if data.get(key)})
    if fields:
        extraction_jobs.apply(db, company, result, ApplyFindings(
            company_revision=company.revision, brand_revision=brand.revision, fields=fields,
        ))


def _company_jobs(company):
    return select(AIJob).where(AIJob.company_id == company.id, AIJob.kind == "content_generation")


def _legacy_generation(db, company):
    # Prefer saved results when a company already made a first post through the old flow.
    post = db.scalar(select(Post.generation_job_id).where(
        Post.company_id == company.id, Post.generation_job_id.is_not(None),
    ).order_by(Post.created_at.asc()).limit(1))
    if post:
        return post
    return db.scalar(_company_jobs(company).with_only_columns(AIJob.id).where(
        AIJob.status.in_(["queued", "running", "completed"]),
    ).order_by(AIJob.created_at.asc()).limit(1))


def read_first_post(db, company):
    handoff = company.onboarding.first_post
    if handoff is None:
        return FirstPostHandoff()
    job_id = handoff.get("job_id")
    if not job_id:
        return FirstPostHandoff(error=handoff.get("error"), retryable=True)
    job = db.scalar(_company_jobs(company).where(AIJob.id == UUID(job_id)))
    return FirstPostHandoff(
        job_id=job_id,
        retryable=bool(job and job.status in {"failed", "cancelled"}),
        pending=bool(job and job.status in {"queued", "running"}),
    )


def _admit_first_post(db, company, user, text_only=False):
    if not ai_provider.text_configured():
        return {"error": f"{ai_provider.label()} text generation is unavailable. Try again when the provider is configured."}
    prefs = company.preferences
    platforms = [PLATFORMS[key] for key in prefs.platforms[:ai_settings.max_posts]]
    wants_images = "image_post" in prefs.content_formats and not text_only
    name = company.brand.display_name or company.name
    topic = f"Introduce {name} and what it offers"
    if company.brand.products_services:
        topic += ": " + ", ".join(company.brand.products_services[:3])
    request = GenerationRequest(
        request_key=uuid4(), platforms=platforms, content_type="image" if wants_images else "text",
        topic=topic[:500], objective=OBJECTIVES.get(prefs.content_goals[0], "brand_awareness"),
        tone=prefs.tone[0], include_images=wants_images, use_recent_social_posts=False,
        instructions="Introduce the business using its confirmed facts. Adapt the angle and call to action to the chosen goal. Use distinct copy for each platform. Do not claim unverified achievements, metrics, products, customers or testimonials.",
    )
    payload = {"context": context_for(db, company), "request": request.model_dump(exclude={"request_key", "published_caption_examples"})}
    extras = len(platforms) if wants_images and ai_provider.image_configured() else 0
    try:
        job = ai_queue.admit(db, company, user, "content_generation", request.request_key, payload,
                            extra_capacity=extras)
    except HTTPException as error:
        if error.status_code not in (409, 429, 503):
            raise
        # The transaction still commits onboarding and the recoverable admission error.
        return {"error": error.detail}
    db.flush()
    return {"job_id": str(job.id)}


def finalize(db, company, user, data):
    progress, prefs = company.onboarding, company.preferences
    if progress.status == "completed":
        return read_first_post(db, company)
    onboarding.check_revision(progress, data.revision)
    onboarding.check_revision(prefs, data.preferences_revision)
    onboarding.validate_step(company, "brand")
    with onboarding.transaction(db):
        # Keep advanced values and the order of secondary preferences from prior setup.
        prefs.platforms = data.platforms
        prefs.content_goals = [data.goal, *(goal for goal in prefs.content_goals if goal != data.goal)]
        prefs.tone = [data.voice, *(voice for voice in prefs.tone if voice != data.voice)]
        prefs.content_formats = prefs.content_formats or ["text_post"]
        prefs.posting_frequency = prefs.posting_frequency or "3_per_week"
        company.status = "active"
        progress.completed_steps = list(dict.fromkeys([*progress.completed_steps, "business", "brand", "preferences"]))
        progress.status = "completed"
        progress.current_step = "preferences"
        progress.completed_at = extraction_jobs.now()
        # Check history before doing any new paid work.
        existing = _legacy_generation(db, company)
        progress.first_post = {"job_id": str(existing)} if existing else _admit_first_post(db, company, user)
    return read_first_post(db, company)


def retry(db, company, user, data):
    progress = company.onboarding
    if progress.status != "completed" or progress.first_post is None:
        raise HTTPException(409, "Complete company setup to start its first post")
    handoff = read_first_post(db, company)
    if not handoff.retryable or handoff.job_id != data.job_id:
        return handoff
    onboarding.validate_step(company, "brand")
    # If another Studio session already generated a draft after a rejected
    # admission, recover it rather than spending quota again.
    existing = _legacy_generation(db, company)
    with onboarding.transaction(db):
        progress.first_post = {"job_id": str(existing)} if existing else _admit_first_post(db, company, user, data.text_only)
    return read_first_post(db, company)


def setup_checklist(db, company):
    def exists(model, *filters):
        return db.scalar(select(model.id).where(model.company_id == company.id, *filters).limit(1)) is not None

    return {
        "brand": company.brand.is_confirmed,
        "post": exists(Post, Post.status != "archived"),
        "competitors": exists(Competitor, Competitor.selection_status == "approved"),
        "accounts": exists(SocialAccount, SocialAccount.status.in_(["connected", "limited"])),
        "schedule": exists(PostSchedule, PostSchedule.status.in_(["scheduled", "awaiting_publisher"])),
    }

