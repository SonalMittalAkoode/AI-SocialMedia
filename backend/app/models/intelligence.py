import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, ForeignKeyConstraint, String, Text, Integer, DateTime, UniqueConstraint, CheckConstraint, Index, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base
from app.models.onboarding import Editable


class AIJob(Base):
    __tablename__ = "ai_jobs"
    __table_args__ = (
        CheckConstraint("kind IN ('competitor_discovery','competitor_research','content_generation','image_generation')", name="ck_ai_job_kind"),
        CheckConstraint("status IN ('queued','running','completed','failed','cancelled')", name="ck_ai_job_status"),
        CheckConstraint("attempt_count BETWEEN 0 AND 3", name="ck_ai_job_attempts"),
        UniqueConstraint("company_id", "request_key", name="uq_ai_job_request"),
        UniqueConstraint("id", "company_id", name="uq_ai_job_company"),
        Index("ix_ai_job_claim", "status", "available_at"),
        # One active operation per company, kind and target. Kinds without a
        # target (content generation, discovery) keep one active job per company.
        Index("uq_ai_job_active", "company_id", "kind", "target_key", unique=True, postgresql_where=text("status IN ('queued','running')")),
        Index("ix_ai_job_batch", "company_id", "batch_id", postgresql_where=text("batch_id IS NOT NULL")),
        Index("ix_ai_job_target", "company_id", "kind", "target_key", "created_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(30))
    request_key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    target_key: Mapped[str] = mapped_column(String(80), default="", server_default="")
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    payload: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(12), default="queued")
    stage: Mapped[str] = mapped_column(String(30), default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(Text)
    model_identifier: Mapped[str | None] = mapped_column(String(150))
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Competitor(Editable, Base):
    __tablename__ = "competitors"
    __table_args__ = (
        UniqueConstraint("company_id", "normalized_domain", name="uq_competitor_domain"),
        UniqueConstraint("id", "company_id", name="uq_competitor_company"),
        CheckConstraint("selection_status IN ('suggested','approved','rejected')", name="ck_competitor_selection"),
        CheckConstraint("verification_status IN ('verified','partially_verified','unverified')", name="ck_competitor_verification"),
        CheckConstraint("relevance_score BETWEEN 0 AND 100", name="ck_competitor_score"),
    )
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    website_url: Mapped[str] = mapped_column(Text)
    normalized_domain: Mapped[str] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str | None] = mapped_column(String(100))
    selection_status: Mapped[str] = mapped_column(String(12), default="suggested")
    verification_status: Mapped[str] = mapped_column(String(20), default="unverified")
    relevance_score: Mapped[int] = mapped_column(Integer, default=0)
    relevance_reason: Mapped[str] = mapped_column(Text, default="Not researched")
    source_provider: Mapped[str] = mapped_column(String(30), default="manual")
    source_url: Mapped[str] = mapped_column(Text)
    # Soft removal keeps research history and evidence; removed rows never feed generation.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CompetitorResearch(Base):
    __tablename__ = "competitor_research_results"
    __table_args__ = (
        ForeignKeyConstraint(["competitor_id", "company_id"], ["competitors.id", "competitors.company_id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(["job_id", "company_id"], ["ai_jobs.id", "ai_jobs.company_id"], ondelete="RESTRICT"),
        UniqueConstraint("competitor_id", "job_id", name="uq_competitor_research_job"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    competitor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    data: Mapped[dict] = mapped_column(JSONB)
    source_evidence: Mapped[list] = mapped_column(JSONB)
    model_identifier: Mapped[str] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
