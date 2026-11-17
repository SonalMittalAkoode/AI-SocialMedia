"""Read projections only: no new persisted entities or publication claims."""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict
from app.schemas.content import PostResponse
from app.schemas.scheduling import ScheduleResponse, CalendarEvent
from app.schemas.onboarding import CompanyResponse


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LibraryPost(PostResponse):
    schedule: ScheduleResponse | None
    asset_count: int
    preview_asset_id: UUID | None


class LibraryPage(Schema):
    company_timezone: str
    items: list[LibraryPost]
    total: int
    limit: int
    offset: int


class SavedResult(Schema):
    result_index: int
    post_id: UUID


class Generation(Schema):
    id: UUID
    status: str
    stage: str
    created_at: datetime
    completed_at: datetime | None
    topic: str
    result_count: int
    saved_results: list[SavedResult]
    error_message: str | None


class GenerationPage(Schema):
    items: list[Generation]
    total: int
    limit: int
    offset: int


class Activity(Schema):
    id: UUID
    schedule_id: UUID
    post_id: UUID
    title: str
    event_type: str
    created_at: datetime


class ContentStats(Schema):
    """Real counts from saved records; no engagement or publishing outcomes."""
    generated_posts: int = 0
    saved_from_generation: int = 0
    manual_posts: int = 0
    generation_jobs_completed: int = 0
    generation_jobs_failed: int = 0
    generation_jobs_active: int = 0
    images_generated: int = 0
    images_uploaded: int = 0
    posts_with_images: int = 0


class CompetitorStats(Schema):
    tracked: int = 0
    researched: int = 0
    approved: int = 0
    informing_generation: int = 0


class DashboardSummary(Schema):
    company_id: UUID
    company_timezone: str
    total_posts: int
    draft_posts: int
    ready_for_review_posts: int
    approved_posts: int
    archived_posts: int
    scheduled_posts: int
    awaiting_publisher: int
    blocked_schedules: int
    recent_posts: list[PostResponse]
    awaiting_approval: list[PostResponse]
    upcoming_schedules: list[CalendarEvent]
    recent_activity: list[Activity]
    recent_generations: list[Generation]
    content_stats: ContentStats = ContentStats()
    competitor_stats: CompetitorStats = CompetitorStats()
    publishing_available: bool = False
    analytics_available: bool = False


class DirectoryCompany(CompanyResponse):
    brand_confirmed: bool
    brand_name: str | None
    platforms: list[str]
    onboarding_status: str


class DirectoryPage(Schema):
    items: list[DirectoryCompany]
    total: int
    limit: int
    offset: int
