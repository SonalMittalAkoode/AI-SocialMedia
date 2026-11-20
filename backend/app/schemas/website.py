from pydantic import Field
from app.schemas.onboarding import Schema


class WebsitePage(Schema):
    url: str = Field(max_length=2048)
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=1000)
    og_title: str | None = Field(default=None, max_length=1000)
    og_description: str | None = Field(default=None, max_length=1000)
    og_image: str | None = Field(default=None, max_length=1000)
    favicon: str | None = Field(default=None, max_length=2048)
    canonical: str | None = Field(default=None, max_length=2048)
    headings: list[str] = Field(max_length=30)
    cleaned_text: str = Field(max_length=12000)
    structured_data: list[dict[str, str]] = Field(max_length=10)
    contacts: list[str] = Field(default_factory=list, max_length=20)
    contact_details: dict[str, str] = Field(default_factory=dict, max_length=5)
    social_links: dict[str, str] = Field(default_factory=dict, max_length=4)
    logo_candidates: list[dict[str,str]] = Field(default_factory=list, max_length=5)
    style_colors: list[str] = Field(default_factory=list, max_length=8)
    stylesheet_urls: list[str] = Field(default_factory=list, max_length=2)


class WebsiteContent(Schema):
    requested_url: str
    resolved_url: str
    pages: list[WebsitePage] = Field(min_length=1, max_length=5)
    social_links: dict[str, str]
    warnings: list[str] = Field(max_length=10)
