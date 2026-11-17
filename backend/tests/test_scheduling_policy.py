from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
import pytest
from pydantic import ValidationError
from app.core.timezones import (as_utc, effective_timezone, in_company_timezone,
    local_date_range, local_to_utc, require_future, validate_timezone)
from app.core.scheduling_config import SchedulingSettings
from app.services.scheduling_policy import (ScheduleState, due_state, validate_plan,
    validate_transition)

UTC = timezone.utc
NOW = datetime(2026, 11, 16, 0, 0, tzinfo=UTC)


@pytest.mark.parametrize('zone', ['Asia/Kolkata', 'Asia/Calcutta', 'UTC', 'America/New_York', 'Europe/London'])
def test_valid_iana_zones(zone):
    assert validate_timezone(zone) == zone


@pytest.mark.parametrize('zone', ['Mars/Olympus', '', '+05:30', '../UTC', 'localtime', 'posix/UTC'])
def test_invalid_zone_never_falls_back(zone):
    with pytest.raises(ValueError):
        effective_timezone(zone, 'Asia/Kolkata')


def test_fallback_is_configurable_and_explicit_company_choice_wins():
    settings = SchedulingSettings(_env_file=None, default_timezone='Europe/London')
    assert effective_timezone(None, settings.default_timezone) == 'Europe/London'
    assert effective_timezone('America/New_York', settings.default_timezone) == 'America/New_York'
    with pytest.raises(ValidationError):
        SchedulingSettings(_env_file=None, default_timezone='invalid')


def test_indian_local_time_converts_to_required_utc_example():
    assert local_to_utc(datetime(2026, 11, 20, 10), 'Asia/Kolkata') == datetime(2026, 11, 20, 4, 30, tzinfo=UTC)


@pytest.mark.parametrize('fold', [None, 0, 1])
def test_nonexistent_dst_wall_time_rejected(fold):
    with pytest.raises(ValueError, match='does not exist'):
        local_to_utc(datetime(2026, 3, 8, 2, 30), 'America/New_York', fold=fold)


def test_ambiguous_wall_time_requires_explicit_fold():
    wall = datetime(2026, 11, 1, 1, 30)
    with pytest.raises(ValueError, match='ambiguous'):
        local_to_utc(wall, 'America/New_York')
    assert local_to_utc(wall, 'America/New_York', fold=0) == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)
    assert local_to_utc(wall, 'America/New_York', fold=1) == datetime(2026, 11, 1, 6, 30, tzinfo=UTC)


def test_half_hour_gap_and_whole_skipped_date_rejected():
    for wall, zone in [(datetime(2026, 10, 4, 2, 15), 'Australia/Lord_Howe'),
                       (datetime(2011, 12, 30, 12), 'Pacific/Apia')]:
        with pytest.raises(ValueError, match='does not exist'):
            local_to_utc(wall, zone)


def test_aware_instant_and_local_wall_representations_cannot_be_confused():
    with pytest.raises(ValueError):as_utc(datetime(2026, 11, 20, 10))
    with pytest.raises(ValueError):local_to_utc(NOW, 'Asia/Kolkata')
    with pytest.raises(ValueError):local_to_utc(datetime(2026, 11, 20, 10), 'UTC', fold=1)
    with pytest.raises(ValueError):local_to_utc(datetime(2026, 11, 20, 10), 'UTC', fold=True)
    assert as_utc(datetime(2026, 11, 20, 10, tzinfo=timezone(timedelta(hours=5, minutes=30)))).hour == 4


@pytest.mark.parametrize('delta', [timedelta(0), timedelta(microseconds=-1)])
def test_past_and_exact_now_rejected(delta):
    with pytest.raises(ValueError):require_future(NOW + delta, now=NOW)


def test_future_uses_supplied_server_clock_without_skew_allowance():
    assert require_future(NOW + timedelta(microseconds=1), now=NOW) > NOW


@pytest.mark.parametrize('start,end,hours', [(date(2026,3,8),date(2026,3,9),23),
    (date(2026,11,1),date(2026,11,2),25), (date(2026,3,1),date(2026,4,1),743)])
def test_half_open_calendar_ranges_account_for_dst(start,end,hours):
    a,b=local_date_range(start,end,'America/New_York')
    assert (b-a).total_seconds()==hours*3600
    assert in_company_timezone(a,'America/New_York').date()==start
    assert in_company_timezone(b,'America/New_York').date()==end


def test_display_zone_changes_local_date_without_reinterpreting_instant():
    instant=datetime(2026,11,20,0,30,tzinfo=UTC)
    assert in_company_timezone(instant,'Asia/Kolkata').date()==date(2026,11,20)
    assert in_company_timezone(instant,'America/New_York').date()==date(2026,11,19)
    assert in_company_timezone(instant,'America/New_York').astimezone(UTC)==instant


def test_no_publishing_state_and_explicit_reschedule_required():
    assert {s.value for s in ScheduleState} == {'scheduled','awaiting_publisher','blocked','cancelled','failed'}
    for state in ('awaiting_publisher','blocked','scheduled'):
        with pytest.raises(ValueError):validate_transition(state,'scheduled')
        validate_transition(state,'scheduled',explicit_reschedule=True)
    validate_transition('scheduled','awaiting_publisher')
    validate_transition('cancelled','cancelled')
    for old,new in [('cancelled','scheduled'),('failed','scheduled'),('scheduled','published'),('blocked','awaiting_publisher')]:
        with pytest.raises(ValueError):validate_transition(old,new,explicit_reschedule=True)


def test_post_eligibility_revision_and_due_policy():
    company_id=uuid4()
    post=SimpleNamespace(company_id=company_id,status='approved',platform='LinkedIn',revision=3)
    args=dict(company_id=company_id,post_revision=3,platform='LinkedIn')
    assert validate_plan(post,**args,scheduled_at=NOW+timedelta(days=1),now=NOW)>NOW
    assert due_state(post,**args,scheduled_at=NOW,now=NOW)==ScheduleState.AWAITING_PUBLISHER
    with pytest.raises(ValueError):due_state(post,**args,scheduled_at=NOW+timedelta(days=1),now=NOW)
    for change in [dict(company_id=uuid4()),dict(post_revision=2),dict(platform='Instagram')]:
        with pytest.raises(ValueError):validate_plan(post,**(args|change),scheduled_at=NOW+timedelta(days=1),now=NOW)
    for status in ('draft','ready_for_review','archived'):
        post.status=status
        with pytest.raises(ValueError):validate_plan(post,**args,scheduled_at=NOW+timedelta(days=1),now=NOW)
