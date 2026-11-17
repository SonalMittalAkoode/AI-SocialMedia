from datetime import datetime
from sqlalchemy import ForeignKey,String,Integer,DateTime,func
from sqlalchemy.orm import Mapped,mapped_column
from app.db.database import Base
from uuid import UUID

class BrandLogo(Base):
    __tablename__ = "brand_logos"
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id",ondelete="RESTRICT"),primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(150))
    mime_type: Mapped[str] = mapped_column(String(50))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    source_url: Mapped[str|None] = mapped_column(String(2048))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),server_default=func.now())
