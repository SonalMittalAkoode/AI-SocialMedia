from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.core.timezones import validate_timezone


class SchedulingSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_prefix='SCHEDULING_', extra='ignore', validate_default=True)
    default_timezone: str = 'Asia/Kolkata'
    poll_seconds: float = Field(default=2, ge=0.2, le=60)
    batch_size: int = Field(default=20, ge=1, le=100)

    @field_validator('default_timezone')
    @classmethod
    def valid_zone(cls, value):
        return validate_timezone(value)


scheduling_settings = SchedulingSettings()
