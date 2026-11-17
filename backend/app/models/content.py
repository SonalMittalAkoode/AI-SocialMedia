"""Editable posts are separate from immutable AIJob results; assets stay private."""
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, ForeignKeyConstraint, UniqueConstraint, CheckConstraint, String, Text, Integer, DateTime, Index, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base
from app.models.onboarding import Editable


class Post(Editable, Base):
    __tablename__ = "posts"
    __table_args__ = (
        UniqueConstraint("id", "company_id", name="uq_post_company"),
        UniqueConstraint("company_id", "creation_key", name="uq_post_creation"),
        UniqueConstraint("company_id", "generation_job_id", "result_index", name="uq_post_generation"),
        ForeignKeyConstraint(["generation_job_id", "company_id"], ["ai_jobs.id", "ai_jobs.company_id"], ondelete="RESTRICT"),
        # The primary image must be an asset of this same post.
        ForeignKeyConstraint(["primary_asset_id", "id"], ["post_assets.id", "post_assets.post_id"], ondelete="RESTRICT", name="fk_post_primary_asset", use_alter=True),
        CheckConstraint("status IN ('draft','ready_for_review','approved','archived')", name="ck_post_status"),
        CheckConstraint("platform IN ('Instagram','LinkedIn','Facebook','X')", name="ck_post_platform"),
    )
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    creation_key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    generation_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    result_index: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    platform: Mapped[str] = mapped_column(String(20))
    content_type: Mapped[str] = mapped_column(String(30))
    caption: Mapped[str] = mapped_column(Text)
    hashtags: Mapped[list] = mapped_column(JSONB, default=list)
    hook: Mapped[str] = mapped_column(Text, default="")
    call_to_action: Mapped[str] = mapped_column(Text, default="")
    image_prompt: Mapped[str] = mapped_column(Text, default="")
    slides: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    primary_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class PostAsset(Base):
    __tablename__ = "post_assets"
    __table_args__ = (
        ForeignKeyConstraint(["post_id", "company_id"], ["posts.id", "posts.company_id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(["job_id", "company_id"], ["ai_jobs.id", "ai_jobs.company_id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(["generation_job_id", "company_id"], ["ai_jobs.id", "ai_jobs.company_id"], ondelete="RESTRICT", name="fk_asset_generation_job"),
        UniqueConstraint("job_id", name="uq_asset_job"),
        UniqueConstraint("id", "post_id", name="uq_asset_post"),
        CheckConstraint("mime_type IN ('image/png','image/jpeg')", name="ck_asset_mime"),
        CheckConstraint("width > 0 AND height > 0 AND size_bytes > 0", name="ck_asset_dimensions"),
        CheckConstraint("source IN ('generated','uploaded','duplicated')", name="ck_asset_source"),
        # Only provider output has an image job; uploads/duplicates never pretend to be generated.
        CheckConstraint("(source = 'generated') = (job_id IS NOT NULL)", name="ck_asset_source_job"),
        # Every asset belongs to a saved post or to one specific unsaved generation result.
        CheckConstraint("post_id IS NOT NULL OR (generation_job_id IS NOT NULL AND result_index IS NOT NULL)", name="ck_asset_owner"),
        CheckConstraint("result_index IS NULL OR result_index BETWEEN 0 AND 2", name="ck_asset_result_index"),
        Index("ix_asset_generation_result", "company_id", "generation_job_id", "result_index", postgresql_where=text("generation_job_id IS NOT NULL")),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    post_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    generation_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    result_index: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(12), default="generated", server_default="generated")
    original_filename: Mapped[str | None] = mapped_column(String(255))
    aspect_ratio: Mapped[str | None] = mapped_column(String(8))
    storage_key: Mapped[str] = mapped_column(String(200), unique=True)
    mime_type: Mapped[str] = mapped_column(String(30))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    generation_model: Mapped[str] = mapped_column(String(150))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PostVersion(Base):
    """Append-only snapshots written by a database trigger before each content change."""
    __tablename__ = "post_versions"
    __table_args__ = (
        ForeignKeyConstraint(["post_id", "company_id"], ["posts.id", "posts.company_id"], ondelete="RESTRICT"),
        UniqueConstraint("post_id", "revision", name="uq_post_version_revision"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"))
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
