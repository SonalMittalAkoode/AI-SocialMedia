from pathlib import Path
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class IntelligenceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_prefix="AI_")
    search_provider: str = "gemini"
    brave_search_api_key: SecretStr | None = None
    brave_research_license_confirmed: bool = False
    grounding_model: str | None = None
    grounding_timeout: int = Field(45, ge=10, le=90)
    grounding_max_attempts: int = Field(1, ge=1, le=2)
    grounding_max_output_tokens: int = Field(2500, ge=512, le=4000)
    grounding_max_suggestions: int = Field(5, ge=1, le=10)
    gemini_image_model: str | None = None
    media_root: Path = Path("var/media")
    max_queries: int = Field(3, ge=1, le=5)
    max_candidates: int = Field(10, ge=1, le=20)
    max_approved_competitors: int = Field(5, ge=1, le=10)
    job_timeout: int = Field(90, ge=20, le=180)
    # Research fetches up to five pages and makes two bounded Gemini calls.
    research_timeout: int = Field(150, ge=60, le=240)
    # Native image models can take longer than structured text responses.
    image_timeout: int = Field(120, ge=30, le=240)
    max_bulk_research: int = Field(10, ge=1, le=20)
    max_attempts: int = Field(2, ge=1, le=3)
    hourly_company_limit: int = Field(12, ge=1, le=50)
    hourly_user_limit: int = Field(24, ge=1, le=100)
    max_queue: int = Field(100, ge=1, le=1000)
    max_posts: int = Field(3, ge=1, le=3)
    max_prompt_chars: int = Field(24000, ge=1000, le=40000)
    max_image_bytes: int = Field(8_000_000, ge=1024, le=10_000_000)
    industry_weight: int = Field(25, ge=0, le=100)
    services_weight: int = Field(30, ge=0, le=100)
    audience_weight: int = Field(20, ge=0, le=100)
    geography_weight: int = Field(15, ge=0, le=100)
    positioning_weight: int = Field(10, ge=0, le=100)


ai_settings = IntelligenceSettings()


def timeout_for(kind: str) -> int:
    return {"competitor_research": ai_settings.research_timeout, "image_generation": ai_settings.image_timeout}.get(kind, ai_settings.job_timeout)
