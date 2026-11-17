from datetime import datetime,timedelta,timezone
from uuid import uuid4
import pytest
from sqlalchemy import text
from app.core.security import create_access_token
from app.models.user import User
from app.models.onboarding import WorkspaceMember
from app.models.scheduling import PostSchedule
from test_onboarding import owner,workspace,company
from test_content import draft


@pytest.fixture
def setup(client,owner,db):
    w=workspace(client);c=company(client,w['id']);root=f"/api/v1/companies/{c['id']}"
    p=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
    p=client.post(root+'/posts/'+p['id']+'/approve',json={'revision':p['revision']}).json()
    return c,w,p,root


def body(p,**changes):
    day=(datetime.now(timezone.utc)+timedelta(days=4)).date().isoformat()
    return dict(post_id=p['id'],target_platform=p['platform'],post_revision=p['revision'],
        local_date=day,local_time='10:00',timezone='Asia/Kolkata',idempotency_key=str(uuid4()))|changes


def test_create_read_filters_timezone_and_audit(client,setup):
    c,w,p,root=setup;data=body(p)
    r=client.post(root+'/schedules',json=data);assert r.status_code==201,r.text
    row=r.json();assert row['scheduled_at'].endswith('04:30:00Z') and row['status']=='scheduled'
    assert client.get(root+'/schedules/'+row['id']).json()['title']==p['title']
    assert len(client.get(root+'/schedules?status=scheduled&platform=Instagram').json())==1
    assert client.get(root+'/schedules?status=cancelled').json()==[]
    day=data['local_date'];end=(datetime.fromisoformat(day)+timedelta(days=1)).date().isoformat()
    events=client.get(root+f'/calendar?start_date={day}&end_date={end}').json()
    assert len(events)==1 and len(events[0]['readiness_warnings'])==2
    assert client.get(root+f'/calendar?start_date={end}&end_date={end}').status_code==422
    assert client.get(root+'/schedules?start=2026-01-01T00:00:00').status_code==422
    history=client.get(root+'/schedules/'+row['id']+'/events').json()
    assert len(history)==1 and history[0]['event_type']=='created' and history[0]['actor_id']


def test_idempotent_create_survives_reschedule_cancel_and_post_edits(client,setup):
    _,_,p,root=setup;data=body(p)
    row=client.post(root+'/schedules',json=data).json();url=root+'/schedules/'+row['id']
    assert client.post(root+'/schedules',json=data).json()['id']==row['id']
    assert client.post(root+'/schedules',json=body(p)).status_code==409
    assert client.post(root+'/schedules',json=data|{'local_time':'11:00'}).status_code==409
    update={k:v for k,v in data.items() if k not in ('post_id','target_platform','idempotency_key')}
    updated=client.patch(url,json=update|{'revision':row['revision'],'local_time':'11:00'})
    assert updated.status_code==200,updated.text
    assert client.patch(url,json=update|{'revision':row['revision']}).status_code==409
    current=updated.json();cancel=client.post(url+'/cancel',json={'revision':current['revision']}).json()
    replay=client.post(url+'/cancel',json={'revision':1}).json()
    assert cancel==replay and client.post(root+'/schedules',json=data).json()['status']=='cancelled'
    assert client.get(root+'/posts/'+p['id']).status_code==200
    assert len(client.get(url+'/events').json())==3


@pytest.mark.parametrize('changes',[{'timezone':'Bad/Zone'},{'local_date':'2000-01-01'},
    {'target_platform':'LinkedIn'},{'post_revision':999},{'local_time':'10:00+05:30'},
    {'local_date':'2027-03-14','local_time':'02:30','timezone':'America/New_York'},
    {'local_date':'2027-11-07','local_time':'01:30','timezone':'America/New_York'}])
def test_invalid_plans(client,setup,changes):
    _,_,p,root=setup
    assert client.post(root+'/schedules',json=body(p,**changes)).status_code==422


def test_unapproved_archive_block_and_explicit_reapproval(client,setup):
    _,_,p,root=setup;data=body(p);row=client.post(root+'/schedules',json=data).json()
    url=root+'/schedules/'+row['id'];posturl=root+'/posts/'+p['id']
    edited=client.patch(posturl,json=draft(revision=p['revision'],caption='Changed approved text')).json()
    blocked=client.get(url).json();assert blocked['status']=='blocked'
    assert client.post(root+'/schedules',json=body(edited)).status_code==422
    approved=client.post(posturl+'/approve',json={'revision':edited['revision']}).json()
    assert client.get(url).json()['status']=='blocked'
    update={k:v for k,v in data.items() if k not in ('post_id','target_platform','idempotency_key')}
    r=client.patch(url,json=update|{'revision':blocked['revision'],'post_revision':approved['revision']})
    assert r.status_code==200,r.text
    archived=client.patch(posturl,json=draft(revision=approved['revision'],status='archived')).json()
    assert client.get(url).json()['status']=='blocked'
    assert client.post(root+'/schedules',json=body(archived)).status_code==422


def test_timezone_preference_revision_and_existing_instants(client,setup):
    _,_,p,root=setup
    row=client.post(root+'/schedules',json=body(p)).json()
    pref=client.get(root+'/scheduling-preferences').json()
    r=client.patch(root+'/scheduling-preferences',json={'revision':pref['revision'],'timezone':'America/New_York'})
    assert r.status_code==200 and r.json()['effective_timezone']=='America/New_York'
    assert client.patch(root+'/scheduling-preferences',json={'revision':pref['revision'],'timezone':'UTC'}).status_code==409
    assert client.get(root+'/schedules/'+row['id']).json()['scheduled_at']==row['scheduled_at']


def test_foreign_user_member_and_cross_company_access(client,db,setup):
    c,w,p,root=setup;row=client.post(root+'/schedules',json=body(p)).json()
    other=company(client,w['id']);foreign=f"/api/v1/companies/{other['id']}"
    assert client.post(foreign+'/schedules',json=body(p)).status_code==404
    assert client.get(foreign+'/schedules/'+row['id']).status_code==404
    user=User(full_name='Schedule member',email=f'{uuid4()}@example.com',hashed_password='unused')
    db.add(user);db.flush();client.cookies.set('access_token',create_access_token(user.id))
    assert client.get(root+'/schedules').status_code==404
    db.add(WorkspaceMember(workspace_id=w['id'],user_id=user.id,role='member'));db.commit()
    assert client.get(root+'/schedules').status_code==200
    assert client.post(root+'/schedules',json=body(p)).status_code==403
    assert client.post(root+'/schedules/'+row['id']+'/cancel',json={'revision':1}).status_code==403
    client.cookies.clear();assert client.get(root+'/schedules').status_code==401
