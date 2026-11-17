"""Real PostgreSQL constraints/triggers in the existing rollback-only fixtures."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm.exc import StaleDataError
from app.models.onboarding import Company
from app.models.content import Post
from app.models.scheduling import PostSchedule
from test_onboarding import owner, workspace, company
from test_content import draft


@pytest.fixture
def approved(client,owner,db):
    c=company(client,workspace(client)['id'])
    root=f"/api/v1/companies/{c['id']}"
    post=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
    response=client.post(root+'/posts/'+post['id']+'/approve',json={'revision':post['revision']})
    assert response.status_code==200,response.text
    return db.get(Post,UUID(post['id']))


def schedule(db,post,**changes):
    values=dict(company_id=post.company_id,post_id=post.id,created_by=post.created_by,
        target_platform=post.platform,scheduled_at=datetime.now(timezone.utc)+timedelta(days=2),
        timezone='Asia/Kolkata',post_revision=post.revision,idempotency_key=uuid4())
    row=PostSchedule(**(values|changes));db.add(row);db.flush();db.refresh(row)
    return row


def test_schema_has_timezone_composite_fk_constraints_and_partial_indexes(db):
    schema=inspect(db.connection())
    columns={c['name']:c for c in schema.get_columns('post_schedules')}
    assert columns['scheduled_at']['type'].timezone
    assert columns['idempotency_key']['nullable'] is False
    assert columns['social_account_id']['nullable'] is True
    foreign=schema.get_foreign_keys('post_schedules')
    assert any(f['constrained_columns']==['post_id','company_id'] and f['referred_table']=='posts' for f in foreign)
    assert all(f['referred_table']!='social_accounts' for f in foreign)
    checks={c['name'] for c in schema.get_check_constraints('post_schedules')}
    assert {'ck_schedule_status','ck_schedule_platform','ck_schedule_timezone','ck_schedule_instant'}<=checks
    indexes={i['name']:i for i in schema.get_indexes('post_schedules')}
    assert indexes['uq_schedule_active']['unique']
    assert 'blocked' in str(indexes['uq_schedule_active']['dialect_options'])
    assert 'postgresql_where' in indexes['ix_schedule_due']['dialect_options']
    triggers=db.scalars(text("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('schedule_guard','block_schedules_on_post_change')")).all()
    assert set(triggers)=={'schedule_guard','block_schedules_on_post_change'}


def test_schedule_roundtrip_preserves_post_and_company_timezone_is_optional(db,approved):
    before=(approved.caption,approved.revision,approved.status)
    c=db.get(Company,approved.company_id);assert c.timezone is None
    row=schedule(db,approved)
    assert row.status=='scheduled' and row.revision==1 and row.scheduled_at.utcoffset()==timedelta(0)
    assert row.social_account_id is None
    old_instant=row.scheduled_at;c.timezone='America/New_York';db.flush();db.refresh(row)
    assert row.scheduled_at==old_instant and row.timezone=='Asia/Kolkata'
    assert (approved.caption,approved.revision,approved.status)==before


@pytest.mark.parametrize('field,value', [('post_revision',0),('post_revision',999),
    ('target_platform','YouTube'),('target_platform','LinkedIn'),('status','published'),
    ('social_account_id',uuid4()),('company_id',uuid4())])
def test_database_rejects_invalid_or_cross_tenant_schedules(db,approved,field,value):
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved,**{field:value})


@pytest.mark.parametrize('status',['draft','ready_for_review','archived'])
def test_database_rejects_unapproved_or_archived_post(db,approved,status):
    approved.status=status;db.flush()
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved)


def test_duplicate_active_and_permanent_idempotency_key(db,approved):
    first=schedule(db,approved)
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved)
    first.status='cancelled';db.flush();db.refresh(first)
    assert first.cancelled_at is not None
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved,idempotency_key=first.idempotency_key)
    second=schedule(db,approved)
    assert second.id!=first.id


def test_database_future_check_naive_datetime_and_infinity_rejection(db,approved):
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved,scheduled_at=datetime.now(timezone.utc)-timedelta(days=1))
    with pytest.raises(StatementError):
        with db.begin_nested():schedule(db,approved,scheduled_at=datetime(2026,11,20))
    row=schedule(db,approved)
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.execute(text("UPDATE post_schedules SET scheduled_at='infinity' WHERE id=:id"),{'id':row.id})


def test_iana_validation_exists_at_both_model_and_database_layers(db,approved):
    c=db.get(Company,approved.company_id)
    with pytest.raises(ValueError):c.timezone='Mars/Olympus'
    with pytest.raises(IntegrityError):
        with db.begin_nested():db.execute(text("UPDATE companies SET timezone='Mars/Olympus' WHERE id=:id"),{'id':c.id})
    row=schedule(db,approved)
    with pytest.raises(ValueError):row.timezone='invalid'
    with pytest.raises(IntegrityError):
        with db.begin_nested():db.execute(text("UPDATE post_schedules SET timezone='invalid' WHERE id=:id"),{'id':row.id})


def test_edit_blocks_schedule_and_preserves_time_and_approved_revision(db,approved):
    row=schedule(db,approved);instant,version= row.scheduled_at,row.post_revision
    approved.caption='A changed, unreviewed draft';approved.status='draft';db.flush();db.refresh(row)
    assert row.status=='blocked' and row.failure_code=='post_changed'
    assert row.scheduled_at==instant and row.post_revision==version and row.revision==2
    # Reapproval alone does not reactivate the old schedule.
    approved.status='approved';db.flush();db.refresh(row);assert row.status=='blocked'
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved)
    row.status='scheduled';row.post_revision=approved.revision;row.scheduled_at=instant+timedelta(days=1)
    db.flush();db.refresh(row)
    assert row.status=='scheduled' and row.failure_code is None and row.post_revision==approved.revision


def test_archive_blocks_and_cancelled_schedule_remains_terminal(db,approved):
    row=schedule(db,approved);approved.status='archived';db.flush();db.refresh(row)
    assert row.status=='blocked' and row.failure_code=='post_archived'
    row.status='cancelled';db.flush();db.refresh(row);stamp,revision=row.cancelled_at,row.revision
    db.execute(text("UPDATE post_schedules SET status='cancelled' WHERE id=:id"),{'id':row.id})
    db.refresh(row);assert row.cancelled_at==stamp and row.revision==revision
    with pytest.raises(IntegrityError):
        with db.begin_nested():db.execute(text("UPDATE post_schedules SET status='scheduled' WHERE id=:id"),{'id':row.id})


def test_schedule_cannot_become_awaiting_publisher_early_or_retargeted(db,approved):
    row=schedule(db,approved)
    for sql in ("status='awaiting_publisher'", "target_platform='Facebook'", "post_id='00000000-0000-4000-8000-000000000000'"):
        with pytest.raises(IntegrityError):
            with db.begin_nested():db.execute(text('UPDATE post_schedules SET '+sql+' WHERE id=:id'),{'id':row.id})


def test_database_invalidation_fences_stale_orm_edits(db,approved):
    row=schedule(db,approved)
    approved.caption='Changed in another operation';db.flush()
    # Loaded row still has the old optimistic version; database trigger advanced it.
    with pytest.raises(StaleDataError):
        with db.begin_nested():
            row.scheduled_at+=timedelta(days=1);db.flush()


def test_actual_cross_company_fk_protection(db,approved,client):
    other=company(client,workspace(client)['id'])
    first=schedule(db,approved)
    with pytest.raises(IntegrityError):
        with db.begin_nested():schedule(db,approved,company_id=UUID(other['id']))
    root=f"/api/v1/companies/{other['id']}"
    post=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
    response=client.post(root+'/posts/'+post['id']+'/approve',json={'revision':post['revision']})
    assert response.status_code==200
    other_post=db.get(Post,UUID(post['id']))
    other_schedule=schedule(db,other_post,idempotency_key=first.idempotency_key)
    assert other_schedule.company_id!=first.company_id


def test_due_transition_and_explicit_rescheduling_use_database_clock(db,approved):
    # One bounded wait exercises the real statement clock and positive DB guard;
    # no worker or external provider is started by this model test.
    now=db.scalar(select(func.clock_timestamp()))
    row=schedule(db,approved,scheduled_at=now+timedelta(seconds=1))
    db.execute(select(func.pg_sleep(1.1)))
    row.status='awaiting_publisher';db.flush();db.refresh(row)
    assert row.claimed_at is not None and row.status=='awaiting_publisher'
    assert row.failure_code is None and row.social_account_id is None
    row.status='scheduled';row.scheduled_at=datetime.now(timezone.utc)+timedelta(days=1)
    db.flush();db.refresh(row)
    assert row.status=='scheduled' and row.claimed_at is None


def test_failure_is_terminal_and_error_details_are_controlled(db,approved):
    row=schedule(db,approved);row.status='failed'
    row.failure_message='Unsafe provider exception text';db.flush();db.refresh(row)
    assert row.failure_code=='scheduling_error' and 'Unsafe' not in row.failure_message
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.execute(text("UPDATE post_schedules SET status='scheduled' WHERE id=:id"),{'id':row.id})
