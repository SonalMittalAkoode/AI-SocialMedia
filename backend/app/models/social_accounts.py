"""Company-owned social account connections (Phase 8A). Connection only: no publishing.

Ownership model: a connection belongs to exactly one company. The same external member
may be authorized separately for several companies; each authorization yields its own row
and its own encrypted credential. Credentials are never shared across companies, and the
composite ``(id, company_id)`` foreign keys make a cross-company credential or reconnect
state impossible to store.
"""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, LargeBinary, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.models.onboarding import Editable

SOCIAL_PLATFORMS = ("LinkedIn", "Instagram", "Facebook", "X")
ACCOUNT_STATUSES = ("connected", "limited", "reconnect_required", "disconnected", "error")
_platforms = ",".join(f"'{p}'" for p in SOCIAL_PLATFORMS)
_statuses = ",".join(f"'{s}'" for s in ACCOUNT_STATUSES)


class SocialAccount(Editable, Base):
    __tablename__ = "social_accounts"
    __table_args__ = (
        UniqueConstraint("company_id", "platform", "provider_account_id", name="uq_social_account_identity"),
        UniqueConstraint("id", "company_id", name="uq_social_account_company"),
        CheckConstraint(f"platform IN ({_platforms})", name="ck_social_account_platform"),
        CheckConstraint("account_type IN ('person','organization')", name="ck_social_account_type"),
        CheckConstraint(f"status IN ({_statuses})", name="ck_social_account_status"),
        CheckConstraint("length(provider_account_id) > 0", name="ck_social_account_provider_id"),
        CheckConstraint("jsonb_typeof(capabilities) = 'array' AND jsonb_typeof(granted_scopes) = 'array'", name="ck_social_account_json"),
        CheckConstraint("(status = 'disconnected') = (disconnected_at IS NOT NULL)", name="ck_social_account_disconnected"),
        Index("ix_social_account_company_status", "company_id", "status"),
    )
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"))
    platform: Mapped[str] = mapped_column(String(20))
    provider_account_id: Mapped[str] = mapped_column(String(255))
    account_type: Mapped[str] = mapped_column(String(20), default="person", server_default="person")
    display_name: Mapped[str | None] = mapped_column(String(300))
    email: Mapped[str | None] = mapped_column(String(320))
    email_verified: Mapped[bool | None] = mapped_column()
    avatar_url: Mapped[str | None] = mapped_column(Text)
    capabilities: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    granted_scopes: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    status: Mapped[str] = mapped_column(String(24))
    last_error_code: Mapped[str | None] = mapped_column(String(40))
    connected_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disconnected_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class SocialAccountCredential(Base):
    """Secret-bearing row. Never serialized by any response schema."""
    __tablename__ = "social_account_credentials"
    __table_args__ = (
        ForeignKeyConstraint(["social_account_id", "company_id"], ["social_accounts.id", "social_accounts.company_id"],
                             ondelete="CASCADE", name="fk_credential_account_company"),
        UniqueConstraint("social_account_id", name="uq_credential_account"),
        CheckConstraint("key_version > 0", name="ck_credential_key_version"),
        CheckConstraint("length(access_token_ciphertext) > 12", name="ck_credential_access_token"),
        CheckConstraint("(refresh_token_ciphertext IS NULL) OR (length(refresh_token_ciphertext) > 12)", name="ck_credential_refresh_token"),
        CheckConstraint("refresh_token_ciphertext IS NOT NULL OR refresh_token_expires_at IS NULL", name="ck_credential_refresh_expiry"),
        CheckConstraint("jsonb_typeof(granted_scopes) = 'array'", name="ck_credential_scopes"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    social_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    key_version: Mapped[int] = mapped_column(Integer)
    access_token_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    refresh_token_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    granted_scopes: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OAuthAuthorizationState(Base):
    """Short-lived, single-use authorization transaction. Only hashes of the state, nonce
    and browser-binding values are stored; the raw values exist only in the redirect/cookie."""
    __tablename__ = "oauth_authorization_states"
    __table_args__ = (
        ForeignKeyConstraint(["target_account_id", "company_id"], ["social_accounts.id", "social_accounts.company_id"],
                             ondelete="CASCADE", name="fk_oauth_state_target_company"),
        CheckConstraint(f"platform IN ({_platforms})", name="ck_oauth_state_platform"),
        CheckConstraint("purpose IN ('connect','reconnect')", name="ck_oauth_state_purpose"),
        CheckConstraint("(purpose = 'reconnect') = (target_account_id IS NOT NULL)", name="ck_oauth_state_target"),
        CheckConstraint("expires_at > created_at", name="ck_oauth_state_expiry"),
        CheckConstraint("length(state_hash) = 64 AND length(nonce_hash) = 64 AND length(binding_hash) = 64", name="ck_oauth_state_hashes"),
        CheckConstraint("jsonb_typeof(requested_scopes) = 'array'", name="ck_oauth_state_scopes"),
        Index("ix_oauth_state_expires", "expires_at"),
        Index("ix_oauth_state_company", "company_id"),
        Index("ix_oauth_state_target", "target_account_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    nonce_hash: Mapped[str] = mapped_column(String(64))
    binding_hash: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    platform: Mapped[str] = mapped_column(String(20))
    purpose: Mapped[str] = mapped_column(String(12))
    target_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    redirect_uri: Mapped[str] = mapped_column(Text)
    return_origin: Mapped[str] = mapped_column(Text)
    requested_scopes: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
