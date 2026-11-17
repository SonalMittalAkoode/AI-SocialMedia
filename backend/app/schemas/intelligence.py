from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, StringConstraints, field_validator
from app.schemas.onboarding import Schema, Revision
from app.services.website_fetcher import validate_url
from app.services.extraction_errors import ExtractionError

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]


class JobRequest(Schema):
    request_key: UUID


class CompetitorCreate(Schema):
    name: Name
    website_url: str = Field(max_length=2048)
    industry: str | None = Field(default=None, max_length=150)
    description: str | None = Field(default=None, max_length=3000)

    @field_validator("website_url")
    @classmethod
    def safe_url(cls, value):
        try: return validate_url(value)
        except ExtractionError as exc: raise ValueError(exc.message) from None


class CompetitorUpdate(Revision):
    name: Name | None = None
    selection_status: Literal["suggested", "approved", "rejected"] | None = None
    website_url: str | None = Field(default=None, max_length=2048)
    industry: str | None = Field(default=None, max_length=150)
    description: str | None = Field(default=None, max_length=3000)
    city: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)

    @field_validator("website_url")
    @classmethod
    def safe_url(cls, value):
        if value is None: return value
        try: return validate_url(value)
        except ExtractionError as exc: raise ValueError(exc.message) from None


class RevisionOnly(Revision):
    pass


class ResearchRequest(JobRequest):
    # Explicit reanalysis bypasses the 24-hour identical-snapshot reuse.
    force: bool = False


class BulkCompetitorItem(Schema):
    name: str = Field(max_length=200)
    website_url: str = Field(max_length=2048)


class BulkCompetitorCreate(Schema):
    request_key: UUID
    competitors: list[BulkCompetitorItem] = Field(min_length=1, max_length=20)
    research: bool = False


class BulkResearchRequest(Schema):
    request_key: UUID
    competitor_ids: list[UUID] = Field(min_length=1, max_length=20)
    force: bool = False


class CompetitorResponse(Schema):
    id: UUID
    company_id: UUID
    name: str
    website_url: str
    industry: str | None
    description: str | None
    city: str | None
    country: str | None
    selection_status: str
    verification_status: str
    relevance_score: int
    relevance_reason: str
    source_provider: str
    source_url: str
    revision: int
    removed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_researched_at: datetime | None = None
    research_job: "AIJobResponse | None" = None


class AIJobResponse(Schema):
    id: UUID
    company_id: UUID
    kind: str
    status: str
    stage: str
    attempt_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
    target_key: str = ""
    batch_id: UUID | None = None


class BulkItemResult(Schema):
    name: str
    website_url: str
    status: Literal["created", "existing", "restored", "invalid"]
    competitor: CompetitorResponse | None = None
    error: str | None = None


class BatchResponse(Schema):
    batch_id: UUID
    total: int
    queued: int
    running: int
    completed: int
    failed: int
    cancelled: int
    jobs: list[AIJobResponse]


class BulkCreateResponse(Schema):
    items: list[BulkItemResult]
    batch: BatchResponse | None = None
    research_error: str | None = None


class ResearchResponse(Schema):
    id: UUID
    competitor_id: UUID
    company_id: UUID
    job_id: UUID
    data: dict
    source_evidence: list[dict]
    model_identifier: str
    created_at: datetime


CompetitorResponse.model_rebuild()
