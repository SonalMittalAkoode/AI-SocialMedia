import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Integer, DateTime, UniqueConstraint, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class ScheduleEvent(Base):
    __tablename__ = 'schedule_events'
    __table_args__ = (
        UniqueConstraint('schedule_id','schedule_revision',name='uq_schedule_event_revision'),
        CheckConstraint("event_type IN ('created','rescheduled','cancelled','awaiting_publisher','blocked','failed')",name='ck_schedule_event_type'),
        CheckConstraint("request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'",name='ck_schedule_event_fingerprint'),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),primary_key=True,default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('post_schedules.id',ondelete='RESTRICT'),index=True)
    schedule_revision: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id',ondelete='RESTRICT'))
    event_type: Mapped[str] = mapped_column(String(24))
    previous_status: Mapped[str | None] = mapped_column(String(24))
    new_status: Mapped[str] = mapped_column(String(24))
    previous_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(100))
    post_revision: Mapped[int] = mapped_column(Integer)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),server_default=func.now())
