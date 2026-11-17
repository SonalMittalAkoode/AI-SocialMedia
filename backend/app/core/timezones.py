"""Pure timezone policy: explicit IANA zones and unambiguous UTC instants."""
from datetime import date, datetime, time, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, available_timezones

UTC = timezone.utc


@lru_cache(maxsize=1)
def _zones():
    return available_timezones() - {'localtime', 'posixrules'}


def validate_timezone(value: str) -> str:
    if not isinstance(value, str) or len(value) > 100 or value not in _zones():
        raise ValueError('Choose a valid IANA timezone')
    return value


def effective_timezone(selected: str | None, fallback: str) -> str:
    # Only an unset choice uses the configured fallback; invalid input never does.
    return validate_timezone(fallback if selected is None else selected)


def as_utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('An offset-aware timestamp is required')
    return value.astimezone(UTC)


def local_to_utc(value: datetime, zone: str, *, fold: int | None = None) -> datetime:
    """Resolve a wall clock by round-trip validation, including gaps and folds.

    Ambiguous times require fold=0 (earlier) or fold=1 (later). Gaps always fail.
    Reject offsets in wall input: callers must not accidentally mix representations.
    """
    if value.tzinfo is not None or value.fold:
        raise ValueError('Supply a naive local datetime and a separate fold choice')
    if fold is not None and (type(fold) is not int or fold not in (0, 1)):
        raise ValueError('Fold must be 0 or 1')
    tz = ZoneInfo(validate_timezone(zone))
    choices = {}
    for choice in (0, 1):
        instant = value.replace(tzinfo=tz, fold=choice).astimezone(UTC)
        restored = instant.astimezone(tz)
        if restored.replace(tzinfo=None, fold=0) == value and restored.fold == choice:
            choices[choice] = instant
    if not choices:
        raise ValueError('This local time does not exist because the clock changes')
    if len(choices) > 1 and fold is None:
        raise ValueError('This local time is ambiguous; explicitly choose fold 0 or 1')
    if fold is not None and fold not in choices:
        raise ValueError('That fold is not valid for this local time')
    return choices[fold if fold is not None else next(iter(choices))]


def require_future(value: datetime, *, now: datetime) -> datetime:
    instant = as_utc(value)
    if instant <= as_utc(now):
        raise ValueError('Schedule time must be strictly in the future')
    return instant


def in_company_timezone(value: datetime, zone: str) -> datetime:
    return as_utc(value).astimezone(ZoneInfo(validate_timezone(zone)))


def local_date_range(start: date, end: date, zone: str) -> tuple[datetime, datetime]:
    """Half-open company-local date interval; never assume each day is 24 hours.

    Exceptional nonexistent/ambiguous midnights fail explicitly instead of moving
    a calendar boundary silently. Callers can supply explicit instant boundaries.
    """
    if start >= end:
        raise ValueError('Range end must follow range start')
    return (local_to_utc(datetime.combine(start, time.min), zone),
            local_to_utc(datetime.combine(end, time.min), zone))
