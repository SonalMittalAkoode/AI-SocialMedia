"""Transactional persistence and state transitions. There is deliberately no website fetch."""
from contextlib import contextmanager
from datetime import datetime, timezone
import re
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm.exc import StaleDataError

from app.models.onboarding import Workspace, WorkspaceMember, Company, BrandProfile, ContentPreferences, OnboardingProgress

STEPS = ["business", "brand", "competitors", "preferences", "generate"]


@contextmanager
def transaction(db):
    try:
        yield
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, "This record changed in another session. Reload server data before trying again.") from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "The request conflicts with existing data. Reload and try again.") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Company storage is temporarily unavailable. Please try again.") from None


def check_revision(record, revision):
    if record.revision != revision:
        raise HTTPException(409, "This record changed in another session. Your local draft is preserved; reload server data before retrying.")


def assign(record, data):
    changed = False
    for key, value in data.items():
        if getattr(record, key) != value:
            setattr(record, key, value)
            changed = True
    return changed


def create_workspace(db, user, data):
    key = data.idempotency_key
    for attempt in range(3):
        existing = db.scalar(select(Workspace).where(Workspace.created_by == user.id, Workspace.creation_key == key)) if key else None
        if existing:
            if existing.name != data.name or existing.description != data.description:
                raise HTTPException(409, "This creation key already belongs to a different workspace request")
            return existing
        slug = re.sub(r"[^a-z0-9]+", "-", data.name.lower()).strip("-")[:140] or "workspace"
        workspace = Workspace(name=data.name, description=data.description, slug=f"{slug}-{uuid4().hex[:12]}", created_by=user.id, creation_key=key)
        db.add(workspace)
        try:
            db.flush()
            db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
            db.commit()
            db.refresh(workspace)
            return workspace
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise HTTPException(409, "Workspace creation conflicted. Retry using the same idempotency key.") from None
        except SQLAlchemyError:
            db.rollback()
            raise HTTPException(503, "Workspace storage is temporarily unavailable") from None


def create_company(db, workspace, data):
    if data.idempotency_key:
        existing = db.scalar(select(Company).where(Company.workspace_id == workspace.id, Company.creation_key == data.idempotency_key))
        if existing:
            if any(getattr(existing, key) != value for key, value in data.model_dump(exclude={"idempotency_key"}).items()):
                raise HTTPException(409, "This creation key already belongs to a different company request")
            return existing
    company = Company(workspace_id=workspace.id, creation_key=data.idempotency_key, **data.model_dump(exclude={"idempotency_key"}))
    try:
        db.add(company)
        db.flush()
        # All four inserts share one transaction; no partially initialized company is committed.
        company.brand = BrandProfile(display_name=company.name, description=company.description)
        company.preferences = ContentPreferences()
        company.onboarding = OnboardingProgress()
        db.commit()
        db.refresh(company)
        return company
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Company).where(Company.workspace_id == workspace.id, Company.creation_key == data.idempotency_key)) if data.idempotency_key else None
        if existing:
            if any(getattr(existing, key) != value for key, value in data.model_dump(exclude={"idempotency_key"}).items()):
                raise HTTPException(409, "This creation key already belongs to a different company request")
            return existing
        raise HTTPException(409, "Company creation conflicted. Retry using the same idempotency key.") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Company storage is temporarily unavailable") from None


def invalidate(company, step):
    progress = company.onboarding
    index = STEPS.index(step)
    progress.completed_steps = [s for s in progress.completed_steps if STEPS.index(s) < index]
    progress.demo_steps = [s for s in progress.demo_steps if s in progress.completed_steps]
    progress.current_step = step
    progress.status = "in_progress"
    progress.completed_at = None
    progress.demo_completed = False
    if company.status == "active":
        company.status = "draft"


def update_company(db, company, data):
    check_revision(company, data.revision)
    if data.expected_brand_revision is not None:
        check_revision(company.brand, data.expected_brand_revision)
    updates = data.model_dump(exclude_unset=True, exclude={"revision", "expected_brand_revision"})
    if updates.get("status") == "active" and company.onboarding.status != "completed":
        raise HTTPException(422, "Complete onboarding before activating this company")
    with transaction(db):
        if assign(company, updates) and company.brand.is_confirmed:
            company.brand.is_confirmed = False
            company.brand.confirmed_at = None
            invalidate(company, "brand")
    return company


def update_brand(db, company, data):
    brand = company.brand
    check_revision(brand, data.revision)
    with transaction(db):
        if assign(brand, data.model_dump(exclude_unset=True, exclude={"revision"})):
            brand.is_confirmed = False
            brand.confirmed_at = None
            if "brand" in company.onboarding.completed_steps:
                invalidate(company, "brand")
    return brand


def confirm_brand(db, company, data):
    brand = company.brand
    check_revision(brand, data.revision)
    if not brand.display_name or len(brand.display_name.strip()) < 2 or not brand.description or len(brand.description.strip()) < 10:
        raise HTTPException(422, "A brand name and a description of at least 10 characters are required")
    with transaction(db):
        if not brand.is_confirmed:
            brand.is_confirmed = True
            brand.confirmed_at = datetime.now(timezone.utc)
    return brand


def update_preferences(db, company, data):
    prefs = company.preferences
    check_revision(prefs, data.revision)
    updates = data.model_dump(exclude_unset=True, exclude={"revision"})
    frequency = updates.get("posting_frequency", prefs.posting_frequency)
    count = updates.get("custom_posts_per_week", prefs.custom_posts_per_week)
    if frequency == "custom" and count is None:
        raise HTTPException(422, "Custom posting frequency requires posts per week")
    with transaction(db):
        if assign(prefs, updates) and "preferences" in company.onboarding.completed_steps:
            invalidate(company, "preferences")
    return prefs


def navigate(db, company, data):
    progress = company.onboarding
    check_revision(progress, data.revision)
    if STEPS.index(data.current_step) > len(progress.completed_steps):
        raise HTTPException(422, "Finish preceding steps before navigating forward")
    with transaction(db):
        progress.current_step = data.current_step
    return progress


def validate_step(company, step, demo_acknowledged=False):
    if step == "business" and len(company.name.strip()) < 2:
        raise HTTPException(422, "Save the company name first")
    if step == "brand" and not company.brand.is_confirmed:
        raise HTTPException(422, "Confirm the saved brand profile first")
    if step in {"competitors", "generate"} and not demo_acknowledged:
        raise HTTPException(422, "Acknowledge this is a demo step; no AI research or generation job is recorded")
    if step == "preferences":
        prefs = company.preferences
        if not all([prefs.platforms, prefs.content_goals, prefs.tone, prefs.content_formats]):
            raise HTTPException(422, "Select at least one platform, goal, tone, and format")


def complete_step(db, company, data):
    progress = company.onboarding
    check_revision(progress, data.revision)
    index = STEPS.index(data.step)
    if any(step not in progress.completed_steps for step in STEPS[:index]):
        raise HTTPException(422, "Finish preceding steps first")
    validate_step(company, data.step, data.demo_acknowledged)
    with transaction(db):
        if data.step not in progress.completed_steps:
            progress.completed_steps = progress.completed_steps + [data.step]
        if data.step in {"competitors", "generate"} and data.step not in progress.demo_steps:
            progress.demo_steps = progress.demo_steps + [data.step]
        progress.current_step = STEPS[min(index + 1, 4)]
    return progress


def complete(db, company, data):
    progress = company.onboarding
    check_revision(progress, data.revision)
    if progress.completed_steps != STEPS or set(progress.demo_steps) != {"competitors", "generate"}:
        raise HTTPException(422, "Finish all required steps and acknowledge the demo stages first")
    for step in STEPS:
        validate_step(company, step, True)
    with transaction(db):
        progress.status = "completed"
        progress.demo_completed = True
        progress.completed_at = datetime.now(timezone.utc)
        progress.current_step = "generate"
        company.status = "active"
    return progress
