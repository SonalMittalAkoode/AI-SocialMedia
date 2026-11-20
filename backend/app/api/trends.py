"""On-demand, display-only trend discovery and independent research notes."""
import asyncio
from datetime import date, datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import select

from app.api.auth import current_user
from app.api.onboarding import request_policy, storage
from app.core.intelligence_config import ai_settings
from app.core.permissions import company_access
from app.models.onboarding import WorkspaceMember
from app.models.trends import TrendNote
from app.schemas.intelligence import JobRequest
from app.schemas.onboarding import Schema
from app.services import ai_provider, gemini_search, openai_search
from app.services.competitor_intelligence import brand_context
from app.services.extraction_errors import ExtractionError
from app.services.onboarding import transaction
from app.services.website_fetcher import validate_url

router = APIRouter(prefix="/companies/{company_id}", tags=["Trend research"], dependencies=[Depends(request_policy)])


class SearchRequest(JobRequest):
    topic: str = Field(default="", max_length=140)
    days: Literal[7, 30, 90] = 30
    note_id: UUID | None = None


class NoteFields(Schema):
    title: str = Field(min_length=2, max_length=180)
    source_url: str = Field(max_length=2048)
    published_on: date | None = None
    finding: str = Field(min_length=10, max_length=1200)


class NewNote(NoteFields):
    request_key: UUID
    independently_reviewed: Literal[True]

    @field_validator("title", "finding", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("source_url")
    @classmethod
    def public_https(cls, value):
        try:
            url = validate_url(value.strip())
        except ExtractionError as exc:
            raise ValueError("Enter a public HTTPS source URL.") from exc
        if not url.startswith("https://"):
            raise ValueError("Enter a public HTTPS source URL.")
        return url

    @field_validator("published_on")
    @classmethod
    def past_date(cls, value):
        if value and value > datetime.now(timezone.utc).date():
            raise ValueError("The source publication date cannot be in the future.")
        return value


class NoteResponse(NoteFields):
    id: UUID
    created_at: datetime


def can_search():
    return ai_provider.is_openai() and openai_search.enabled()


def active_note(db, company_id, note_id):
    row = db.scalar(select(TrendNote).where(
        TrendNote.company_id == company_id, TrendNote.id == note_id, TrendNote.dismissed_at.is_(None),
    ))
    if row is None:
        raise HTTPException(404, "Research note not found.")
    return row


@router.get("/trend-capabilities")
def capabilities(company_id: UUID, user=Depends(current_user), db=Depends(storage)):
    company = company_access(db, user, company_id)
    role = db.scalar(select(WorkspaceMember.role).where(
        WorkspaceMember.workspace_id == company.workspace_id, WorkspaceMember.user_id == user.id,
    ))
    return {"search_configured": can_search(), "brand_confirmed": company.brand.is_confirmed,
            "can_manage": role in {"owner", "admin"}}


@router.post("/trend-search", response_model=gemini_search.GroundedAnswer)
async def search(company_id: UUID, data: SearchRequest, user=Depends(current_user), db=Depends(storage)):
    company = company_access(db, user, company_id, True)
    if not can_search():
        raise HTTPException(503, "OpenAI web search is unavailable. Independent notes remain available.")
    brand = brand_context(company)
    # The provider only needs a market and sector. Exclude contact data, brand
    # guidelines, internal audience definitions, other notes, and tenant IDs.
    context = {"industry": brand["industry"] or brand["business_type"], "country": brand["country"]}
    note = None
    if data.note_id:
        note = NoteFields.model_validate(active_note(db, company_id, data.note_id)).model_dump(mode="json")
    if not (context["industry"] or data.topic.strip() or note):
        raise HTTPException(422, "Enter a focus topic or add your industry in Brand Profile.")
    key = gemini_search.begin_request(db, company, user, data.request_key, {}, provider="openai",
                                      model=ai_provider.research_model(), kind="trend_search")
    provider = openai_search.OpenAIWebSearchProvider()
    try:
        async with asyncio.timeout(ai_settings.grounding_timeout):
            answer = await provider.search_trends(context, data.topic.strip(), data.days, note)
    except (Exception, asyncio.CancelledError) as exc:
        if isinstance(exc, ExtractionError):
            error = exc
        elif isinstance(exc, TimeoutError):
            error = ExtractionError("search_timeout", "Trend research timed out. Start a new search to try again.")
        else:
            error = ExtractionError("search_unavailable", "Trend research could not be completed.")
        gemini_search.finish_request(db, key, provider.usage, error, provider="openai")
        if isinstance(exc, asyncio.CancelledError):
            raise
        status = 429 if error.code == "search_rate_limited" else 504 if error.code == "search_timeout" else 502
        raise HTTPException(status, error.message) from None
    if not gemini_search.finish_request(db, key, provider.usage, provider="openai"):
        raise HTTPException(409, "Trend research was cancelled or expired.")
    return answer


@router.get("/trend-notes", response_model=list[NoteResponse])
def notes(company_id: UUID, offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=50),
          user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id)
    return db.scalars(select(TrendNote).where(TrendNote.company_id == company_id, TrendNote.dismissed_at.is_(None))
                      .order_by(TrendNote.created_at.desc(), TrendNote.id).offset(offset).limit(limit)).all()


@router.post("/trend-notes", response_model=NoteResponse, status_code=201)
def save_note(company_id: UUID, data: NewNote, user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id, True)
    payload = data.model_dump(exclude={"request_key", "independently_reviewed"})
    row = db.scalar(select(TrendNote).where(TrendNote.company_id == company_id, TrendNote.creation_key == data.request_key))
    if row:
        if row.dismissed_at or any(getattr(row, key) != value for key, value in payload.items()):
            raise HTTPException(409, "This request key belongs to a different research note.")
        return row
    row = TrendNote(company_id=company_id, created_by=user.id, creation_key=data.request_key, **payload)
    with transaction(db):
        db.add(row)
    return row


@router.delete("/trend-notes/{note_id}", status_code=204)
def dismiss_note(company_id: UUID, note_id: UUID, user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id, True)
    row = db.scalar(select(TrendNote).where(TrendNote.company_id == company_id, TrendNote.id == note_id))
    if row is None:
        raise HTTPException(404, "Research note not found.")
    if row.dismissed_at is None:
        with transaction(db):
            row.dismissed_at = datetime.now(timezone.utc)

