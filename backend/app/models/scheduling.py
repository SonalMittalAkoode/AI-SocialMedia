"""Scheduling storage foundation only; no API, polling loop or publishing."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import TypeDecorator
from app.db.database import Base
from app.models.onboarding import Editable
from app.core.timezones import as_utc, validate_timezone


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return as_utc(value) if value is not None else None

    def process_result_value(self, value, dialect):
        return as_utc(value) if value is not None else None


class PostSchedule(Editable, Base):
    __tablename__ = 'post_schedules'
    __table_args__ = (
        ForeignKeyConstraint(['post_id', 'company_id'], ['posts.id', 'posts.company_id'], ondelete='RESTRICT', name='fk_schedule_post_company'),
        UniqueConstraint('company_id', 'idempotency_key', name='uq_schedule_creation'),
        CheckConstraint("target_platform IN ('Instagram','LinkedIn','Facebook','X')", name='ck_schedule_platform'),
        CheckConstraint("status IN ('scheduled','awaiting_publisher','blocked','cancelled','failed')", name='ck_schedule_status'),
        CheckConstraint('post_revision > 0 AND revision > 0', name='ck_schedule_revisions'),
        CheckConstraint('socialai_is_timezone(timezone)', name='ck_schedule_timezone'),
        CheckConstraint('isfinite(scheduled_at)', name='ck_schedule_instant'),
        CheckConstraint('social_account_id IS NULL', name='ck_schedule_no_account'),
        CheckConstraint("(status = 'cancelled') = (cancelled_at IS NOT NULL)", name='ck_schedule_cancelled'),
        CheckConstraint("status <> 'awaiting_publisher' OR claimed_at IS NOT NULL", name='ck_schedule_claimed'),
        CheckConstraint('claimed_at IS NULL OR isfinite(claimed_at)', name='ck_schedule_claim_instant'),
        CheckConstraint('cancelled_at IS NULL OR isfinite(cancelled_at)', name='ck_schedule_cancel_instant'),
        CheckConstraint("(status IN ('blocked','failed')) = (failure_code IS NOT NULL AND failure_message IS NOT NULL) AND (status IN ('blocked','failed') OR (failure_code IS NULL AND failure_message IS NULL))", name='ck_schedule_failure'),
        Index('ix_schedule_calendar', 'company_id', 'scheduled_at', 'id'),
        Index('ix_schedule_post', 'post_id', 'company_id'),
        Index('ix_schedule_due', 'scheduled_at', 'id', postgresql_where=text("status = 'scheduled'")),
        Index('uq_schedule_active', 'company_id', 'post_id', 'target_platform', unique=True,
              postgresql_where=text("status IN ('scheduled','awaiting_publisher','blocked')")),
    )
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('companies.id', ondelete='RESTRICT'))
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='RESTRICT'))
    target_platform: Mapped[str] = mapped_column(String(20))
    social_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    scheduled_at: Mapped[datetime] = mapped_column(UTCDateTime())
    timezone: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(24), default='scheduled', server_default='scheduled')
    post_revision: Mapped[int] = mapped_column(Integer)
    idempotency_key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    failure_code: Mapped[str | None] = mapped_column(String(40))
    failure_message: Mapped[str | None] = mapped_column(Text)
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    @validates('timezone')
    def valid_zone(self, key, value):
        return validate_timezone(value)
