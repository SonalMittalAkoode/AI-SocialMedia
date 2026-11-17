"""Company-scoped, bounded CRM projections over existing records."""
from datetime import datetime, timezone, timedelta, time
from zoneinfo import ZoneInfo
from sqlalchemy import select, func, or_, case, exists
from app.models.content import Post, PostAsset
from app.models.scheduling import PostSchedule
from app.models.schedule_events import ScheduleEvent
from app.models.intelligence import AIJob, Competitor, CompetitorResearch
from app.models.onboarding import Company, BrandProfile, ContentPreferences, OnboardingProgress
from app.schemas.content import PostResponse
from app.schemas.scheduling import ScheduleResponse
from app.schemas.onboarding import CompanyResponse
from app.services.scheduling import calendar_rows, zone_for


def post_query(company_id, q='', platform=None, status=None):
    query = select(Post).where(Post.company_id == company_id)
    if q:
        query = query.where(or_(Post.title.icontains(q, autoescape=True), Post.caption.icontains(q, autoescape=True)))
    if platform:
        query = query.where(Post.platform == platform)
    if status:
        query = query.where(Post.status == status)
    return query


def local_day_bounds(zone, start, end):
    """Inclusive local calendar dates -> UTC [from, to) instants in the company timezone."""
    tz = ZoneInfo(zone)
    lower = datetime.combine(start, time.min, tzinfo=tz).astimezone(timezone.utc) if start else None
    upper = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc) if end else None
    return lower, upper


def library(db, company_id, q, platform, status, sort, limit, offset, created_from=None, created_to=None, zone='UTC', media=None):
    base = post_query(company_id, q, platform, status)
    lower, upper = local_day_bounds(zone, created_from, created_to)
    if lower:
        base = base.where(Post.created_at >= lower)
    if upper:
        base = base.where(Post.created_at < upper)
    if media:
        base = base.where(Post.primary_asset_id.is_not(None) if media == 'with_image' else Post.primary_asset_id.is_(None))
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    column = Post.created_at if sort.startswith('created') else Post.updated_at
    ordering = column.asc() if sort.endswith('asc') else column.desc()
    # Scalar projections use existing company/post indexes; only one representative
    # schedule and asset reference per post, never unbounded related histories.
    schedule_id = select(PostSchedule.id).where(PostSchedule.company_id == company_id,
        PostSchedule.post_id == Post.id).order_by(
        case((PostSchedule.status.in_(['scheduled', 'awaiting_publisher', 'blocked']), 0), else_=1),
        PostSchedule.updated_at.desc(), PostSchedule.id).limit(1).correlate(Post).scalar_subquery()
    asset_count = select(func.count()).select_from(PostAsset).where(
        PostAsset.company_id == company_id, PostAsset.post_id == Post.id).correlate(Post).scalar_subquery()
    latest_asset = select(PostAsset.id).where(PostAsset.company_id == company_id,
        PostAsset.post_id == Post.id).order_by(PostAsset.created_at.desc(), PostAsset.id).limit(1).correlate(Post).scalar_subquery()
    # The image the post actually uses; older posts without a choice fall back to the newest asset.
    asset_id = func.coalesce(Post.primary_asset_id, latest_asset)
    rows = db.execute(base.add_columns(schedule_id, asset_count, asset_id)
        .order_by(ordering, Post.id).limit(limit).offset(offset)).all()
    ids = [sid for _, sid, _, _ in rows if sid]
    schedules = {s.id: ScheduleResponse.model_validate(s).model_dump() for s in db.scalars(
        select(PostSchedule).where(PostSchedule.company_id == company_id, PostSchedule.id.in_(ids)))} if ids else {}
    return {'items': [{**PostResponse.model_validate(p).model_dump(), 'schedule': schedules.get(sid),
        'asset_count': count, 'preview_asset_id': aid} for p, sid, count, aid in rows],
        'total': total, 'limit': limit, 'offset': offset}


def generation_history(db, company_id, limit=20, offset=0):
    where = (AIJob.company_id == company_id, AIJob.kind == 'content_generation')
    total = db.scalar(select(func.count()).select_from(AIJob).where(*where))
    jobs = db.scalars(select(AIJob).where(*where).order_by(AIJob.created_at.desc(), AIJob.id)
        .limit(limit).offset(offset)).all()
    saved = {}
    if jobs:
        for job_id, index, post_id in db.execute(select(Post.generation_job_id, Post.result_index, Post.id)
            .where(Post.company_id == company_id, Post.generation_job_id.in_([j.id for j in jobs]))):
            saved.setdefault(job_id, []).append({'result_index': index, 'post_id': post_id})
    return {'items': [{'id': j.id, 'status': j.status, 'stage': j.stage, 'created_at': j.created_at,
        'completed_at': j.completed_at, 'topic': str((j.payload or {}).get('request', {}).get('topic', 'Content generation'))[:500],
        'result_count': min(3, len((j.result or {}).get('posts', []))) if j.status == 'completed' else 0,
        'saved_results': saved.get(j.id, []), 'error_message': j.error_message} for j in jobs],
        'total': total, 'limit': limit, 'offset': offset}


def summary(db, company):
    counts = db.execute(select(func.count(Post.id), *[func.count(Post.id).filter(Post.status == s)
        for s in ['draft', 'ready_for_review', 'approved', 'archived']]).where(Post.company_id == company.id)).one()
    plans = db.execute(select(func.count(func.distinct(PostSchedule.post_id)).filter(PostSchedule.status == 'scheduled'),
        func.count(func.distinct(PostSchedule.post_id)).filter(PostSchedule.status == 'awaiting_publisher'),
        func.count(PostSchedule.id).filter(PostSchedule.status == 'blocked'))
        .where(PostSchedule.company_id == company.id)).one()
    recent = db.scalars(post_query(company.id).order_by(Post.updated_at.desc(), Post.id).limit(6)).all()
    review = db.scalars(post_query(company.id).where(Post.status.in_(['draft', 'ready_for_review']))
        .order_by(case((Post.status == 'ready_for_review', 0), else_=1), Post.updated_at.desc(), Post.id).limit(5)).all()
    activity = db.execute(select(ScheduleEvent.id, PostSchedule.id, Post.id, Post.title,
        ScheduleEvent.event_type, ScheduleEvent.created_at).select_from(ScheduleEvent).join(PostSchedule, PostSchedule.id == ScheduleEvent.schedule_id)
        .join(Post, (Post.id == PostSchedule.post_id) & (Post.company_id == PostSchedule.company_id))
        .where(PostSchedule.company_id == company.id)
        .order_by(ScheduleEvent.created_at.desc(), ScheduleEvent.id).limit(6)).all()
    return dict(zip(('total_posts', 'draft_posts', 'ready_for_review_posts', 'approved_posts', 'archived_posts'), counts)) | {
        'company_id': company.id, 'company_timezone': zone_for(company),
        'scheduled_posts': plans[0], 'awaiting_publisher': plans[1], 'blocked_schedules': plans[2],
        'recent_posts': recent, 'awaiting_approval': review,
        'upcoming_schedules': calendar_rows(db, company.id, datetime.now(timezone.utc), None, None, 'scheduled', 5, 0),
        'recent_activity': [dict(zip(('id', 'schedule_id', 'post_id', 'title', 'event_type', 'created_at'), r)) for r in activity],
        'recent_generations': generation_history(db, company.id, 4)['items'],
        'content_stats': content_stats(db, company.id), 'competitor_stats': competitor_stats(db, company.id),
        'publishing_available': False, 'analytics_available': False}


def content_stats(db, company_id):
    generated = func.coalesce(func.jsonb_array_length(AIJob.result['posts']), 0)
    jobs = db.execute(select(
        func.coalesce(func.sum(case((AIJob.status == 'completed', generated), else_=0)), 0),
        func.count(AIJob.id).filter(AIJob.status == 'completed'),
        func.count(AIJob.id).filter(AIJob.status == 'failed'),
        func.count(AIJob.id).filter(AIJob.status.in_(['queued', 'running'])))
        .where(AIJob.company_id == company_id, AIJob.kind == 'content_generation')).one()
    posts = db.execute(select(func.count(Post.id).filter(Post.generation_job_id.is_not(None)),
        func.count(Post.id).filter(Post.generation_job_id.is_(None)),
        func.count(Post.id).filter(Post.primary_asset_id.is_not(None))).where(Post.company_id == company_id)).one()
    assets = db.execute(select(func.count(PostAsset.id).filter(PostAsset.source == 'generated'),
        func.count(PostAsset.id).filter(PostAsset.source == 'uploaded')).where(PostAsset.company_id == company_id)).one()
    return {'generated_posts': int(jobs[0]), 'generation_jobs_completed': jobs[1], 'generation_jobs_failed': jobs[2],
            'generation_jobs_active': jobs[3], 'saved_from_generation': posts[0], 'manual_posts': posts[1],
            'posts_with_images': posts[2], 'images_generated': assets[0], 'images_uploaded': assets[1]}


def competitor_stats(db, company_id):
    researched = exists().where(CompetitorResearch.company_id == company_id, CompetitorResearch.competitor_id == Competitor.id)
    row = db.execute(select(func.count(Competitor.id), func.count(Competitor.id).filter(researched),
        func.count(Competitor.id).filter(Competitor.selection_status == 'approved'),
        func.count(Competitor.id).filter(Competitor.selection_status == 'approved', researched,
            Competitor.verification_status.in_(['verified', 'partially_verified'])))
        .where(Competitor.company_id == company_id, Competitor.removed_at.is_(None))).one()
    return dict(zip(('tracked', 'researched', 'approved', 'informing_generation'), row))


def directory(db, workspace_id, q, limit, offset):
    base = select(Company).where(Company.workspace_id == workspace_id)
    if q:
        base = base.where(or_(Company.name.icontains(q, autoescape=True), Company.description.icontains(q, autoescape=True)))
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(base.add_columns(BrandProfile.is_confirmed, BrandProfile.display_name,
        ContentPreferences.platforms, OnboardingProgress.status)
        .join(BrandProfile, BrandProfile.company_id == Company.id)
        .join(ContentPreferences, ContentPreferences.company_id == Company.id)
        .join(OnboardingProgress, OnboardingProgress.company_id == Company.id)
        .order_by(Company.name, Company.id).limit(limit).offset(offset)).all()
    return {'items': [{**CompanyResponse.model_validate(c).model_dump(), 'brand_confirmed': confirmed,
        'brand_name': name, 'platforms': platforms, 'onboarding_status': status}
        for c, confirmed, name, platforms, status in rows], 'total': total, 'limit': limit, 'offset': offset}
