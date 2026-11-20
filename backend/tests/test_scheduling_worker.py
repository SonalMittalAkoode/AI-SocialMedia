"""Real DB transactions, including two independent worker connections."""
import time
import asyncio
import pytest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from threading import Barrier
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from app.main import app
from app.db.database import SessionLocal
from app.models.user import User
from app.models.onboarding import Company
from app.models.scheduling import PostSchedule
from app.models.schedule_events import ScheduleEvent
from app.core.security import create_access_token
from app.workers.scheduling import process_due
from test_onboarding import owner, workspace, company
from test_scheduling_models import approved, schedule
from test_content import draft


def test_batch_is_bounded_and_audit_is_immutable(db, approved, client):
    rows=[]
    for i in range(3):
        p=client.post(f'/api/v1/companies/{approved.company_id}/posts',json=draft(creation_key=str(uuid4()))).json()
        p=client.post(f"/api/v1/companies/{approved.company_id}/posts/{p['id']}/approve",json={'revision':p['revision']}).json()
        from app.models.content import Post
        rows.append(schedule(db,db.get(Post,UUID(p['id'])),scheduled_at=datetime.now(timezone.utc)+timedelta(seconds=.4)))
    time.sleep(.5)
    factory=lambda:Session(bind=db.connection(),join_transaction_mode='create_savepoint')
    assert process_due(factory,company_id=approved.company_id,batch_size=1)==1
    assert process_due(factory,company_id=approved.company_id,batch_size=1)==1
    assert process_due(factory,company_id=approved.company_id,batch_size=1)==1
    assert process_due(factory,company_id=approved.company_id)==0
    from sqlalchemy import text
    with pytest.raises(SQLAlchemyError),db.begin_nested():
        db.execute(text("UPDATE schedule_events SET event_type='failed' WHERE schedule_id=:id"),{'id':rows[0].id})


def test_scheduler_retries_transient_storage_failure(monkeypatch):
    from app.workers import scheduling as worker
    calls=[];delays=[]
    async def to_thread(fn):
        calls.append(fn)
        if len(calls)==1:raise SQLAlchemyError('private storage detail')
        return 0
    async def sleep(delay):
        delays.append(delay)
        if len(delays)==2:raise asyncio.CancelledError
    monkeypatch.setattr(worker.asyncio,'to_thread',to_thread)
    monkeypatch.setattr(worker.asyncio,'sleep',sleep)
    with pytest.raises(asyncio.CancelledError):asyncio.run(worker.run_scheduler())
    assert len(calls)==2 and delays[0]>=5 and delays[1]==worker.limits.poll_seconds


def test_shared_worker_scheduling_runs_during_long_ai_job(monkeypatch):
    from app.workers import extraction as worker
    closed=[]
    class Analyzer:
        async def close(self):closed.append(True)
    class Storage:
        def __enter__(self):return self
        def __exit__(self,*args):pass
    async def exercise():
        started=asyncio.Event();tick=asyncio.Event()
        async def scheduler():
            await started.wait();tick.set();await asyncio.Future()
        async def ai(*args):
            started.set();await asyncio.wait_for(tick.wait(),1);raise asyncio.CancelledError
        monkeypatch.setattr(worker,'run_scheduler',scheduler)
        monkeypatch.setattr(worker,'run_intelligence_job',ai)
        with pytest.raises(asyncio.CancelledError):await worker.main()
        assert tick.is_set()
    monkeypatch.setattr(worker,'SessionLocal',Storage)
    monkeypatch.setattr(worker.ai_provider,'create_analyzer',Analyzer)
    monkeypatch.setattr(worker.ai_queue,'claim',lambda db:('isolated-test',))
    asyncio.run(exercise());assert closed==[True]


def test_due_future_cancelled_blocked_restart_and_atomic_history(db, approved):
    row = schedule(db, approved, scheduled_at=datetime.now(timezone.utc)+timedelta(seconds=.4))
    time.sleep(.5)
    factory = lambda: Session(bind=db.connection(), join_transaction_mode='create_savepoint')
    assert process_due(factory, company_id=approved.company_id) == 1
    db.refresh(row)
    assert row.status == 'awaiting_publisher' and row.claimed_at
    assert process_due(factory, company_id=approved.company_id) == 0
    events = db.scalars(select(ScheduleEvent).where(ScheduleEvent.schedule_id == row.id)).all()
    assert {e.event_type for e in events} == {'created', 'awaiting_publisher'}
    assert next(e for e in events if e.event_type=='awaiting_publisher').actor_id is None
    row.status='cancelled';db.flush()
    future=schedule(db,approved)
    assert process_due(factory,company_id=approved.company_id)==0
    approved.status='draft';db.flush();db.refresh(future)
    assert future.status=='blocked'
    assert process_due(factory,company_id=approved.company_id)==0


def test_concurrent_workers_and_rollback_recovery():
    # Isolated committed fixture, retained with an explicit test name. No existing
    # records are edited/deleted; real independent connections see the same item.
    with SessionLocal() as db:
        user=User(full_name='Scheduling concurrency test',email=f'schedule-{uuid4().hex}@example.com',hashed_password='unused-test-account')
        db.add(user);db.commit();token=create_access_token(user.id)
    with TestClient(app,base_url='http://localhost:8000',headers={'Origin':'http://localhost:3000'}) as client:
        client.cookies.set('access_token',token)
        c=company(client,workspace(client,name='Scheduling concurrency test')['id'])
        root=f"/api/v1/companies/{c['id']}"
        p=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
        p=client.post(root+'/posts/'+p['id']+'/approve',json={'revision':p['revision']}).json()
    with SessionLocal() as db:
        db.scalar(select(Company).where(Company.id==UUID(c['id'])).with_for_update())
        row=PostSchedule(company_id=UUID(c['id']),post_id=UUID(p['id']),created_by=user.id,
            target_platform=p['platform'],scheduled_at=datetime.now(timezone.utc)+timedelta(seconds=.4),
            timezone='UTC',post_revision=p['revision'],idempotency_key=uuid4())
        db.add(row);db.flush();schedule_id=row.id
        time.sleep(.5)
        # Simulate a process disappearing before its transition can commit.
        # Hold the company lock while staging this fixture so a running shared
        # worker cannot win before the rollback has actually been exercised.
        with db.begin_nested() as savepoint:
            row.status='awaiting_publisher';db.flush();savepoint.rollback()
        db.refresh(row);assert row.status=='scheduled'
        db.commit()
    barrier=Barrier(2)
    def run():
        barrier.wait()
        return process_due(company_id=UUID(c['id']))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(run) for _ in range(2)]
        # A separately running shared worker may also win the same claim.
        assert sum(f.result() for f in futures)<=1
    assert process_due(company_id=UUID(c['id']))==0
    with SessionLocal() as db:
        db.scalar(select(Company).where(Company.id==UUID(c['id'])).with_for_update())
        assert db.get(PostSchedule,schedule_id).status=='awaiting_publisher'
        assert db.scalar(select(func.count()).select_from(ScheduleEvent).where(
            ScheduleEvent.schedule_id==schedule_id,ScheduleEvent.event_type=='awaiting_publisher'))==1
