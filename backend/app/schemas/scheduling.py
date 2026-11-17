from datetime import date, time, datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.content import Platform
from app.services.scheduling_policy import ScheduleState
from app.core.timezones import validate_timezone


class Schema(BaseModel):
    model_config=ConfigDict(extra='forbid',from_attributes=True)


class Plan(Schema):
    post_revision: int=Field(ge=1)
    local_date: date
    local_time: time
    timezone: str | None=None
    fold: int | None=Field(default=None,ge=0,le=1)

    @field_validator('timezone')
    @classmethod
    def zone(cls,v):return validate_timezone(v) if v is not None else None

    @field_validator('fold',mode='before')
    @classmethod
    def explicit_fold(cls,v):
        if v is not None and type(v) is not int:raise ValueError('Fold must be 0 or 1')
        return v

    @field_validator('local_time')
    @classmethod
    def wall_time(cls,v):
        if v.tzinfo is not None or v.second or v.microsecond:raise ValueError('Use a local time with minute precision and no offset')
        return v


class ScheduleCreate(Plan):
    post_id: UUID
    target_platform: Platform
    idempotency_key: UUID


class ScheduleUpdate(Plan):
    revision: int=Field(ge=1)


class CancelRequest(Schema):
    revision: int=Field(ge=1)


class TimezoneUpdate(CancelRequest):
    timezone: str | None
    @field_validator('timezone')
    @classmethod
    def zone(cls,v):return validate_timezone(v) if v is not None else None


class TimezoneResponse(Schema):
    timezone: str | None
    effective_timezone: str
    revision: int


class ScheduleResponse(Schema):
    id: UUID
    company_id: UUID
    post_id: UUID
    target_platform: Platform
    scheduled_at: datetime
    timezone: str
    status: ScheduleState
    post_revision: int
    revision: int
    failure_code: str | None
    failure_message: str | None
    claimed_at: datetime | None
    cancelled_at: datetime | None


class CalendarEvent(ScheduleResponse):
    company_timezone: str
    title: str
    preview: str
    approval_status: str
    current_post_revision: int
    readiness_warnings: list[str]


class EventResponse(Schema):
    id: UUID
    schedule_revision: int
    actor_id: UUID | None
    event_type: str
    previous_status: str | None
    new_status: str
    previous_scheduled_at: datetime | None
    scheduled_at: datetime
    timezone: str
    post_revision: int
    created_at: datetime
