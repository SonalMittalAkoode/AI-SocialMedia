
from typing import Literal
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    POSTGRES_HOST: str = "127.0.0.1"
    POSTGRES_PORT: int = 5433
    POSTGRES_USER: str = "socialai"
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = "socialai_db"
    # Active AI provider for every workflow. No automatic fallback between providers.
    AI_PROVIDER: Literal["openai", "gemini"] = "openai"
    # Gemini stays available as an explicitly selectable provider (AI_PROVIDER=gemini).
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.8-flash"
    OPENAI_API_KEY: SecretStr | None = None
    OPENAI_TEXT_MODEL: str = ""
    OPENAI_RESEARCH_MODEL: str = ""
    OPENAI_IMAGE_MODEL: str = ""
    OPENAI_PREMIUM_IMAGE_MODEL: str = ""
    OPENAI_WEB_SEARCH_ENABLED: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    @property
    def DATABASE_URL(self) -> URL:
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_HOST,
            port=self.POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )


settings = Settings()
