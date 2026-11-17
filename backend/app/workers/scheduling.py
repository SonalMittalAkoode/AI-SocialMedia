"""Bounded, atomic local transitions; no publisher or external network calls."""
import asyncio
import logging
import time
from sqlalchemy import select, func
from sqlalchemy.exc import SQLAlchemyError
from app.db.database import SessionLocal
from app.models.onboarding import Company
from app.models.content import Post
from app.models.scheduling import PostSchedule
from app.models.schedule_events import ScheduleEvent  # noqa: F401; audit metadata
from app.core.scheduling_config import scheduling_settings as limits
from app.services.scheduling import actor
from app.services.scheduling_policy import due_state

logger = logging.getLogger('socialai.scheduling')


def process_due(session_factory=SessionLocal, *, company_id=None, batch_size=None):
    """Lock company -> post -> schedule, SKIP LOCKED, commit state + audit once.

    Each item uses a short transaction. A crash before commit rolls back the
    claim; after commit the item is no longer eligible. No expiring lease is
    needed for this local, atomic operation. Oldest due companies go first.
    """
    processed = 0
    skipped = set()
    deadline = time.monotonic() + 2
    for _ in range(min(batch_size or limits.batch_size, 100)):
        if time.monotonic() >= deadline:
            break
        with session_factory() as db:
            due = (select(func.min(PostSchedule.scheduled_at))
                   .where(PostSchedule.company_id == Company.id,
                          PostSchedule.status == 'scheduled',
                          PostSchedule.scheduled_at <= func.clock_timestamp())
                   .correlate(Company).scalar_subquery())
            query = select(Company).where(due.is_not(None)).order_by(due, Company.id)
            if company_id is not None:
                query = query.where(Company.id == company_id)
            if skipped:
                query = query.where(Company.id.not_in(skipped))
            company = db.scalar(query.limit(1).with_for_update(skip_locked=True))
            if company is None:
                break
            post = db.scalar(select(Post).join(PostSchedule,
                (PostSchedule.post_id == Post.id) & (PostSchedule.company_id == Post.company_id))
                .where(Post.company_id == company.id, PostSchedule.status == 'scheduled',
                       PostSchedule.scheduled_at <= func.clock_timestamp())
                .order_by(PostSchedule.scheduled_at, PostSchedule.id).limit(1)
                .with_for_update(of=Post, skip_locked=True))
            if post is None:
                skipped.add(company.id)
                continue
            row = db.scalar(select(PostSchedule).where(
                PostSchedule.company_id == company.id, PostSchedule.post_id == post.id,
                PostSchedule.status == 'scheduled', PostSchedule.scheduled_at <= func.clock_timestamp())
                .order_by(PostSchedule.scheduled_at, PostSchedule.id).limit(1)
                .with_for_update(skip_locked=True))
            if row is None:
                skipped.add(company.id)
                continue
            actor(db, None)
            try:
                row.status = due_state(post, company_id=company.id,
                    post_revision=row.post_revision, platform=row.target_platform,
                    scheduled_at=row.scheduled_at, now=db.scalar(select(func.clock_timestamp())))
            except ValueError:
                row.status = 'blocked'
                row.failure_code = 'post_changed'
                row.failure_message = 'Post changed. Review and explicitly reschedule.'
            schedule_id = row.id
            state = row.status
            db.commit()
            processed += 1
            logger.info('schedule=%s company=%s status=%s', schedule_id, company.id, state)
    return processed


async def run_scheduler():
    # Started once by the existing worker entrypoint; independent of long AI I/O.
    while True:
        try:
            await asyncio.to_thread(process_due)
            delay = limits.poll_seconds
        except SQLAlchemyError:
            logger.warning('Scheduling storage unavailable; retrying batch')
            delay = max(5, limits.poll_seconds)
        await asyncio.sleep(delay)
