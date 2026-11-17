"""Workspace ownership and editable company onboarding; no AI jobs or production posts."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, declared_attr, validates
from app.core.timezones import validate_timezone

from app.db.database import Base


class Editable:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    @declared_attr.directive
    def __mapper_args__(cls):
        return {"version_id_col": cls.revision}


class Workspace(Editable, Base):
    __tablename__ = "workspaces"
    __table_args__ = (UniqueConstraint("created_by", "creation_key", name="uq_workspace_creation"), CheckConstraint("length(trim(name)) >= 2", name="ck_workspace_name"))
    name: Mapped[str] = mapped_column(String(150))
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    description: Mapped[str | None] = mapped_column(Text)
    creation_key: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    creator = relationship("User")
    members = relationship("WorkspaceMember", back_populates="workspace", passive_deletes=True)
    companies = relationship("Company", back_populates="workspace", passive_deletes=True)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member"), CheckConstraint("role IN ('owner','admin','member')", name="ck_member_role"))
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    role: Mapped[str] = mapped_column(String(12), default="member", server_default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User")


class Company(Editable, Base):
    __tablename__ = "companies"
    __table_args__ = (UniqueConstraint("workspace_id", "creation_key", name="uq_company_creation"), CheckConstraint("status IN ('draft','active','archived')", name="ck_company_status"), CheckConstraint("length(trim(name)) >= 2", name="ck_company_name"), CheckConstraint('timezone IS NULL OR socialai_is_timezone(timezone)', name='ck_company_timezone'))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), index=True)
    creation_key: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(200))
    website_url: Mapped[str | None] = mapped_column(Text)
    source_social_url: Mapped[str | None] = mapped_column(Text)
    industry: Mapped[str | None] = mapped_column(String(150))
    business_type: Mapped[str | None] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(150))
    status: Mapped[str] = mapped_column(String(12), default="draft", server_default="draft")
    timezone: Mapped[str | None] = mapped_column(String(100))

    @validates('timezone')
    def valid_timezone(self, key, value):
        return None if value is None else validate_timezone(value)

    workspace = relationship("Workspace", back_populates="companies")
    brand = relationship("BrandProfile", back_populates="company", uselist=False, passive_deletes=True)
    preferences = relationship("ContentPreferences", back_populates="company", uselist=False, passive_deletes=True)
    onboarding = relationship("OnboardingProgress", back_populates="company", uselist=False, passive_deletes=True)


class BrandProfile(Editable, Base):
    __tablename__ = "brand_profiles"
    __table_args__ = (CheckConstraint("source IN ('manual','imported','ai')", name="ck_brand_source"), CheckConstraint("is_confirmed = (confirmed_at IS NOT NULL)", name="ck_brand_confirmation"), CheckConstraint("jsonb_typeof(brand_colors) = 'array' AND jsonb_typeof(brand_voice) = 'array' AND jsonb_typeof(products_services) = 'array' AND jsonb_typeof(brand_keywords) = 'array' AND jsonb_typeof(social_links) = 'object'", name="ck_brand_json"))
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(200))
    tagline: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(Text)
    brand_colors: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    brand_voice: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    target_audience: Mapped[str | None] = mapped_column(Text)
    products_services: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    brand_keywords: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    social_links: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    content_guidelines: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(12), default="manual", server_default="manual")
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    company = relationship("Company", back_populates="brand")


class ContentPreferences(Editable, Base):
    __tablename__ = "content_preferences"
    __table_args__ = (CheckConstraint("language IN ('english','hindi','hinglish')", name="ck_preference_language"), CheckConstraint("custom_posts_per_week IS NULL OR custom_posts_per_week BETWEEN 1 AND 21", name="ck_preference_frequency"), CheckConstraint("jsonb_typeof(platforms) = 'array' AND jsonb_typeof(content_goals) = 'array' AND jsonb_typeof(tone) = 'array' AND jsonb_typeof(content_formats) = 'array' AND jsonb_typeof(excluded_topics) = 'array'", name="ck_preferences_json"))
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), unique=True)
    platforms: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    content_goals: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    tone: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    content_formats: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    posting_frequency: Mapped[str | None] = mapped_column(String(20))
    custom_posts_per_week: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(12), default="english", server_default="english")
    custom_instructions: Mapped[str | None] = mapped_column(Text)
    excluded_topics: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    company = relationship("Company", back_populates="preferences")


class OnboardingProgress(Base):
    __tablename__ = "onboarding_progress"
    __table_args__ = (CheckConstraint("current_step IN ('business','brand','competitors','preferences','generate')", name="ck_onboarding_step"), CheckConstraint("status IN ('in_progress','completed')", name="ck_onboarding_status"), CheckConstraint("(status = 'completed') = (completed_at IS NOT NULL) AND (status <> 'completed' OR demo_completed)", name="ck_onboarding_completion"), CheckConstraint("jsonb_typeof(completed_steps) = 'array' AND jsonb_typeof(demo_steps) = 'array'", name="ck_onboarding_json"))
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), unique=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    current_step: Mapped[str] = mapped_column(String(16), default="business", server_default="business")
    completed_steps: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    demo_steps: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    demo_completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(16), default="in_progress", server_default="in_progress")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    company = relationship("Company", back_populates="onboarding")
    __mapper_args__ = {"version_id_col": revision}
