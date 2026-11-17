"""Non-secret, bounded extraction controls. Gemini secrets remain in existing settings."""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ExtractionSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_prefix="EXTRACTION_")
    max_pages: int = Field(5, ge=1, le=5)
    request_timeout: float = Field(10, ge=1, le=15)
    job_timeout: float = Field(60, ge=10, le=120)
    max_bytes: int = Field(2_000_000, ge=1024, le=2_000_000)
    max_text: int = Field(30000, ge=1000, le=50000)
    max_redirects: int = Field(3, ge=0, le=3)
    max_attempts: int = Field(2, ge=1, le=3)
    max_queue: int = Field(100, ge=1, le=1000)
    company_hourly_limit: int = Field(6, ge=1, le=20)
    user_hourly_limit: int = Field(12, ge=1, le=50)


extraction_settings = ExtractionSettings()
