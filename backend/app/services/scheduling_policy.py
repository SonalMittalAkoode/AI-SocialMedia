"""Pure state/revision policy for Phase 7B, deliberately without database writes.

Future authorized services must lock company -> post -> schedule, check schedule
revision, then apply these decisions atomically. No publisher exists here.
"""
from datetime import datetime
from enum import StrEnum
from app.core.timezones import as_utc, require_future


class ScheduleState(StrEnum):
    SCHEDULED = 'scheduled'
    AWAITING_PUBLISHER = 'awaiting_publisher'
    BLOCKED = 'blocked'
    CANCELLED = 'cancelled'
    FAILED = 'failed'


TRANSITIONS = {
    'scheduled': frozenset({'awaiting_publisher', 'blocked', 'cancelled', 'failed'}),
    'awaiting_publisher': frozenset({'scheduled', 'blocked', 'cancelled', 'failed'}),
    'blocked': frozenset({'scheduled', 'cancelled'}),
    'cancelled': frozenset(),
    'failed': frozenset(),
}


def validate_transition(previous: str, target: str, *, explicit_reschedule: bool = False) -> None:
    if previous == target == 'scheduled' and explicit_reschedule:
        return
    if previous == target == 'cancelled':
        return  # Cancellation replay is a no-op, preserving its timestamp/revision.
    if target not in TRANSITIONS.get(previous, ()):
        raise ValueError('Invalid schedule state transition')
    if target == 'scheduled' and not explicit_reschedule:
        raise ValueError('Returning to scheduled requires explicit rescheduling')


def validate_approved_post(post, *, company_id, post_revision: int, platform: str) -> None:
    if post is None or post.company_id != company_id:
        raise ValueError('Post does not belong to this company')
    if post.status != 'approved':
        raise ValueError('Only approved, non-archived posts may be scheduled')
    if post.revision != post_revision:
        raise ValueError('Post revision changed; review and approve the current draft')
    if post.platform != platform:
        raise ValueError('Target platform must match the approved post')


def validate_plan(post, *, company_id, post_revision: int, platform: str,
                  scheduled_at: datetime, now: datetime) -> datetime:
    validate_approved_post(post, company_id=company_id, post_revision=post_revision, platform=platform)
    return require_future(scheduled_at, now=now)


def due_state(post, *, company_id, post_revision: int, platform: str,
              scheduled_at: datetime, now: datetime) -> ScheduleState:
    # A policy decision only; claiming and applying it is Phase 7D work.
    validate_approved_post(post, company_id=company_id, post_revision=post_revision, platform=platform)
    if as_utc(scheduled_at) > as_utc(now):
        raise ValueError('The scheduled instant has not arrived')
    return ScheduleState.AWAITING_PUBLISHER
