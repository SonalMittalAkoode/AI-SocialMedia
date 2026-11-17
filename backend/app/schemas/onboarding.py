from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
import re
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Step = Literal["business", "brand", "competitors", "preferences", "generate"]
Platform = Literal["instagram", "facebook", "linkedin", "x"]
Goal = Literal["brand_awareness", "lead_generation", "audience_engagement", "website_traffic", "product_promotion", "community_building"]
Tone = Literal["professional", "friendly", "funny", "bold", "inspirational", "educational", "trendy", "premium", "playful", "minimal"]
Format = Literal["image_post", "carousel", "text_post", "promotional", "educational", "meme"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]
SOCIAL_DOMAINS = {"instagram": "instagram.com", "facebook": "facebook.com", "linkedin": "linkedin.com", "x": "x.com"}


def normalize_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    if len(value) > 2048 or re.search(r"[\s\x00-\x1f\x7f\\]", value.strip()):
        raise ValueError("Use an HTTP(S) URL without whitespace, credentials, or control characters")
    try:
        parsed = urlsplit(value.strip())
        host = parsed.hostname.encode("idna").decode("ascii").lower() if parsed.hostname else ""
        port = parsed.port
    except (ValueError, UnicodeError):
        raise ValueError("Invalid URL hostname or port") from None
    if parsed.scheme.lower() not in {"http", "https"} or not host or parsed.username is not None or parsed.password is not None:
        raise ValueError("Use a full HTTP(S) URL without credentials")
    if not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.rstrip(".").split(".")):
        raise ValueError("Invalid URL hostname")
    netloc = host + (f":{port}" if port else "")
    return urlunsplit((parsed.scheme.lower(), netloc, parsed.path or "", parsed.query, ""))


def social_url(value: str | None, platform: str | None = None) -> str | None:
    value = normalize_url(value)
    if value:
        host = urlsplit(value).hostname
        domains = [SOCIAL_DOMAINS[platform]] if platform else list(SOCIAL_DOMAINS.values())
        if platform in {None, "x"}:
            domains.append("twitter.com")
        if not any(host == domain or host.endswith("." + domain) for domain in domains):
            raise ValueError("Use a supported social platform profile URL")
    return value


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class Revision(Schema):
    revision: int = Field(ge=1)


class WorkspaceCreate(Schema):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=150)]
    description: Text | None = None
    idempotency_key: UUID | None = None


class WorkspaceUpdate(Revision):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=150)] = Field(default=None)
    description: Text | None = None


class WorkspaceResponse(Schema):
    id: UUID
    name: str
    slug: str
    created_by: UUID
    description: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class WorkspaceMemberResponse(Schema):
    id: UUID
    workspace_id: UUID
    user_id: UUID
    role: Literal["owner", "admin", "member"]
    joined_at: datetime


class CompanyFields(Schema):
    website_url: str | None = None
    source_social_url: str | None = None
    industry: Annotated[str, StringConstraints(strip_whitespace=True, max_length=150)] | None = None
    business_type: Annotated[str, StringConstraints(strip_whitespace=True, max_length=150)] | None = None
    description: Text | None = None
    country: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    city: Annotated[str, StringConstraints(strip_whitespace=True, max_length=150)] | None = None

    @field_validator("website_url")
    @classmethod
    def website(cls, value):
        return normalize_url(value)

    @field_validator("source_social_url")
    @classmethod
    def social(cls, value):
        return social_url(value)

    @field_validator("industry", "business_type", "description", "country", "city")
    @classmethod
    def empty_is_unknown(cls, value):
        return value or None


class CompanyCreate(CompanyFields):
    name: Name
    idempotency_key: UUID | None = None


class CompanyUpdate(CompanyFields, Revision):
    expected_brand_revision: int | None = Field(default=None, ge=1)
    name: Name = Field(default=None)
    status: Literal["draft", "active", "archived"] = Field(default=None)


class CompanyResponse(CompanyFields):
    id: UUID
    workspace_id: UUID
    name: str
    status: str
    revision: int
    created_at: datetime
    updated_at: datetime


class BrandProfileUpdate(Revision):
    display_name: Name | None = None
    tagline: Annotated[str, StringConstraints(max_length=500)] | None = None
    description: Text | None = None
    logo_url: str | None = None
    brand_colors: list[Annotated[str, StringConstraints(pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")]] = Field(default_factory=list, max_length=10)
    brand_voice: list[Short] = Field(default_factory=list, max_length=12)
    target_audience: Text | None = None
    products_services: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=50)
    brand_keywords: list[Short] = Field(default_factory=list, max_length=30)
    social_links: dict[Platform, str] = Field(default_factory=dict, max_length=4)
    content_guidelines: Text | None = None
    source: Literal["manual", "imported"] = "manual"

    @field_validator("logo_url")
    @classmethod
    def logo(cls, value):
        return normalize_url(value)

    @field_validator("social_links")
    @classmethod
    def links(cls, value):
        return {key: social_url(url, key) for key, url in value.items() if url.strip()}


class BrandProfileResponse(Schema):
    id: UUID
    company_id: UUID
    display_name: str | None
    tagline: str | None
    description: str | None
    logo_url: str | None
    brand_colors: list[str]
    brand_voice: list[str]
    target_audience: str | None
    products_services: list[str]
    brand_keywords: list[str]
    social_links: dict[str, str]
    content_guidelines: str | None
    source: str
    is_confirmed: bool
    confirmed_at: datetime | None
    revision: int
    created_at: datetime
    updated_at: datetime


class ContentPreferencesUpdate(Revision):
    platforms: list[Platform] = Field(default_factory=list, max_length=4)
    content_goals: list[Goal] = Field(default_factory=list, max_length=6)
    tone: list[Tone] = Field(default_factory=list, max_length=10)
    content_formats: list[Format] = Field(default_factory=list, max_length=6)
    posting_frequency: Literal["2_per_week", "3_per_week", "5_per_week", "daily", "custom"] | None = None
    custom_posts_per_week: int | None = Field(default=None, ge=1, le=21)
    language: Literal["english", "hindi", "hinglish"] = "english"
    custom_instructions: Text | None = None
    excluded_topics: list[Short] = Field(default_factory=list, max_length=30)

    @field_validator("platforms", "content_goals", "tone", "content_formats", "excluded_topics")
    @classmethod
    def unique(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Duplicate selections are not allowed")
        return value


class ContentPreferencesResponse(ContentPreferencesUpdate):
    id: UUID
    company_id: UUID
    created_at: datetime
    updated_at: datetime


class OnboardingProgressResponse(Schema):
    id: UUID
    company_id: UUID
    current_step: Step
    completed_steps: list[Step]
    demo_steps: list[Step]
    demo_completed: bool
    status: Literal["in_progress", "completed"]
    started_at: datetime
    completed_at: datetime | None
    updated_at: datetime
    revision: int


class OnboardingStepUpdate(Revision):
    current_step: Step


class OnboardingCompleteStepRequest(Revision):
    step: Step
    demo_acknowledged: bool = False
