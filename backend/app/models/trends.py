"""Company-scoped research authored and reviewed by a workspace user."""
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.models.onboarding import Editable


class TrendNote(Editable, Base):
    __tablename__ = "trend_notes"
    __table_args__ = (UniqueConstraint("company_id", "creation_key", name="uq_trend_note_creation"),)

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    creation_key: Mapped[UUID]
    title: Mapped[str] = mapped_column(String(180))
    source_url: Mapped[str] = mapped_column(String(2048))
    published_on: Mapped[date | None] = mapped_column(Date)
    finding: Mapped[str] = mapped_column(Text)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

