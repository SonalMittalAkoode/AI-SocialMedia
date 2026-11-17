from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, field_validator
from app.schemas.onboarding import Schema, BrandProfileUpdate, CompanyUpdate, social_url
from app.services.website_fetcher import validate_url
from app.services.extraction_errors import ExtractionError

Small = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Detail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=3000)]
Confidence = Literal["high", "medium", "low"]
FieldName = Literal["company_name", "industry", "business_type", "description", "tagline", "target_audience", "products_services", "brand_voice", "brand_keywords", "brand_colors", "suggested_brand_colors", "social_links", "city", "state", "country", "public_email", "public_phone", "value_proposition", "content_pillars", "suggested_content_tone"]


class Evidence(Schema):
    field: FieldName
    value: Annotated[str, StringConstraints(max_length=3000)]
    source_url: Annotated[str, StringConstraints(max_length=2048)] | None = None
    supporting_text: Annotated[str, StringConstraints(max_length=1500)] | None = None
    classification: Literal["explicit", "inferred", "suggested", "unknown"]
    confidence: Confidence


class BrandAnalysis(Schema):
    company_name: Annotated[str, StringConstraints(min_length=2, max_length=200)] | None = None
    industry: Annotated[str, StringConstraints(max_length=150)] | None = None
    business_type: Annotated[str, StringConstraints(max_length=150)] | None = None
    description: Detail | None = None
    tagline: Detail | None = None
    target_audience: list[Small] = Field(default_factory=list, max_length=10)
    products_services: list[Small] = Field(default_factory=list, max_length=30)
    brand_voice: list[Small] = Field(default_factory=list, max_length=10)
    brand_keywords: list[Small] = Field(default_factory=list, max_length=30)
    brand_colors: list[Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]] = Field(default_factory=list, max_length=8)
    suggested_brand_colors: list[Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]] = Field(default_factory=list,max_length=8)
    social_links: dict[Literal["instagram", "facebook", "linkedin", "x"], str] = Field(default_factory=dict)
    city: Small | None = None
    country: Small | None = None
    state: Small | None = None
    public_email: Annotated[str, StringConstraints(max_length=254)] | None = None
    public_phone: Small | None = None
    value_proposition: Detail | None = None
    content_pillars: list[Small] = Field(default_factory=list, max_length=10)
    suggested_content_tone: list[Small] = Field(default_factory=list, max_length=10)
    overall_confidence: Confidence = "low"
    field_evidence: list[Evidence] = Field(default_factory=list, max_length=80)
    warnings: list[Detail] = Field(default_factory=list, max_length=15)

    @field_validator("social_links")
    @classmethod
    def valid_social(cls, value):
        return {key: social_url(url, key) for key, url in value.items()}


class StartExtraction(Schema):
    url: Annotated[str, StringConstraints(max_length=2048)]
    reanalyze: bool = False

    @field_validator("url")
    @classmethod
    def safe_url(cls, value):
        try:
            return validate_url(value)
        except ExtractionError as exc:
            raise ValueError(exc.message) from None


class JobResponse(Schema):
    id: UUID
    company_id: UUID
    requested_url: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    stage: str
    attempt_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ResultResponse(Schema):
    id: UUID
    job_id: UUID
    company_id: UUID
    extracted_data: BrandAnalysis
    source_evidence: list[Evidence]
    source_pages: list[dict]
    warnings: list[str]
    model_identifier: str
    analysis_version: str
    created_at: datetime


class ApplyFindings(Schema):
    company_revision: int = Field(ge=1)
    brand_revision: int = Field(ge=1)
    fields: dict[FieldName, str | list[str] | dict[str, str] | None] = Field(min_length=1, max_length=24)


def adapt_approved(data: ApplyFindings, existing_guidelines=""):
    """Only explicitly supplied fields are mapped to compatible existing columns."""
    company, brand = {}, {}
    for key, value in data.fields.items():
        if key == "company_name":
            company["name"] = value
            brand["display_name"] = value
        elif key in {"industry", "business_type", "city", "state", "country", "public_email", "public_phone"}:
            company[key] = value
        elif key == "description":
            company[key] = value
            brand[key] = value
        elif key == "products_services":
            brand["products_services"] = value
        elif key == "suggested_brand_colors":
            brand["brand_colors"] = list(dict.fromkeys(brand.get("brand_colors",[])+value))[:8]
        elif key == "target_audience":
            brand[key] = ", ".join(value) if isinstance(value, list) else value
        elif key in {"value_proposition", "content_pillars", "suggested_content_tone"}:
            if not isinstance(value, (str, list)) or value is None:
                raise ValueError("Invalid recommendation")
            line = key.replace("_", " ").capitalize() + ": " + (", ".join(value) if isinstance(value, list) else value)
            previous = brand.get("content_guidelines", existing_guidelines or "")
            brand["content_guidelines"] = previous if line in previous.splitlines() else (previous + "\n" + line).strip()
        else:
            brand[key] = value
    c = CompanyUpdate(revision=data.company_revision, **company)
    b = BrandProfileUpdate(revision=data.brand_revision, **brand)
    return c.model_dump(exclude_unset=True, exclude={"revision", "expected_brand_revision"}), b.model_dump(exclude_unset=True, exclude={"revision"})
