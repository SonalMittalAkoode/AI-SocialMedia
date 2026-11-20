"""Public social-account contracts. Allowlist-only: no token, ciphertext, key version,
provider subject identifier, OAuth state or secret configuration value is serializable."""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

AccountStatus = Literal["connected", "limited", "reconnect_required", "disconnected", "error"]
PlatformName = Literal["LinkedIn", "Instagram", "Facebook", "X"]


class SocialAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    platform: PlatformName
    account_type: Literal["person", "organization"]
    display_name: str | None
    email: str | None
    email_verified: bool | None
    avatar_url: str | None
    capabilities: list[str]
    granted_scopes: list[str]
    status: AccountStatus
    publishing_permission: bool
    refresh_available: bool
    last_error_code: str | None
    connected_at: datetime
    last_verified_at: datetime | None
    token_expires_at: datetime | None
    disconnected_at: datetime | None
    revision: int
    created_at: datetime
    updated_at: datetime


class SocialAccountList(BaseModel):
    items: list[SocialAccountResponse]
    connected_count: int
    publishing_enabled: bool = False  # Phase 8A never publishes


class AccountStatusResponse(BaseModel):
    id: UUID
    status: AccountStatus
    publishing_permission: bool
    refresh_available: bool
    token_expires_at: datetime | None
    last_verified_at: datetime | None
    last_error_code: str | None
    checked_at: datetime
    provider_checked: bool = False


class PlatformCapability(BaseModel):
    platform: PlatformName
    slug: str
    integration: Literal["available", "configuration_required", "coming_later"]
    description: str
    requested_scopes: list[str]
    publishing_scope_requested: bool
    supports_refresh_tokens: Literal["provider_dependent", "no", "unknown"]
    supports_provider_revocation: bool
    configuration_issues: list[str]


class PlatformList(BaseModel):
    items: list[PlatformCapability]
    publishing_enabled: bool = False


class AuthorizationStart(BaseModel):
    authorization_url: str
    expires_at: datetime


class DisconnectResponse(BaseModel):
    account: SocialAccountResponse
    provider_access_revoked: bool
    guidance: str
