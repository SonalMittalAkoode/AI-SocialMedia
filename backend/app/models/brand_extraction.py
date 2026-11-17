import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, ForeignKeyConstraint, String, Text, Integer, DateTime, CheckConstraint, UniqueConstraint, Index, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class BrandExtractionJob(Base):
    __tablename__ = "brand_extraction_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','completed','failed','cancelled')", name="ck_extraction_status"),
        CheckConstraint("stage IN ('queued','fetching','cleaning','analyzing','saving','completed','failed','cancelled')", name="ck_extraction_stage"),
        CheckConstraint("attempt_count >= 0 AND attempt_count <= 3", name="ck_extraction_attempts"),
        UniqueConstraint("id", "company_id", name="uq_job_company"),
        Index("ix_extraction_claim", "status", "available_at"),
        Index("uq_active_company_extraction", "company_id", unique=True, postgresql_where=text("status IN ('queued','running')")),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    requested_url: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="queued")
    stage: Mapped[str] = mapped_column(String(12), default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(Text)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BrandExtractionResult(Base):
    __tablename__ = "brand_extraction_results"
    __table_args__ = (ForeignKeyConstraint(["job_id", "company_id"], ["brand_extraction_jobs.id", "brand_extraction_jobs.company_id"], ondelete="RESTRICT"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    extracted_data: Mapped[dict] = mapped_column(JSONB)
    source_evidence: Mapped[list] = mapped_column(JSONB)
    source_pages: Mapped[list] = mapped_column(JSONB)
    warnings: Mapped[list] = mapped_column(JSONB)
    extraction_method: Mapped[str] = mapped_column(String(20), default="hybrid")
    model_identifier: Mapped[str] = mapped_column(String(150))
    analysis_version: Mapped[str] = mapped_column(String(30), default="brand-v1")
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
