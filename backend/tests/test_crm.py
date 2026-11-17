from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import time
import pytest
from sqlalchemy import select, event
from app.models.content import Post, PostAsset
from app.models.intelligence import AIJob
from app.models.onboarding import BrandProfile, WorkspaceMember
from app.models.user import User
from app.core.security import create_access_token
from test_onboarding import owner, workspace, company
from test_content import draft
from test_scheduling_models import schedule


@pytest.fixture
def setup(client, owner):
    w=workspace(client);c=company(client,w['id'])
    return c,w,f"/api/v1/companies/{c['id']}"


def saved(client, root, **fields):
    response=client.post(root+'/posts',json=draft(creation_key=str(uuid4()),**fields))
    assert response.status_code==201,response.text
    return response.json()


def test_real_summary_counts_and_schedule_semantics(client,setup,db):
    c,w,root=setup
    empty=client.get(root+'/dashboard/summary').json()
    assert empty['total_posts']==empty['scheduled_posts']==0 and empty['recent_posts']==[]
    a=saved(client,root);b=saved(client,root,title='Approved queue');arch=saved(client,root,title='Archived draft')
    b=client.post(root+f"/posts/{b['id']}/approve",json={'revision':b['revision']}).json()
    client.patch(root+f"/posts/{arch['id']}",json=draft(title=arch['title'],revision=arch['revision'],status='archived'))
    row=schedule(db,db.get(Post,UUID(b['id'])))
    data=client.get(root+'/dashboard/summary').json()
    assert {k:data[k] for k in ['total_posts','draft_posts','approved_posts','archived_posts','scheduled_posts','awaiting_publisher','blocked_schedules']}==dict(total_posts=3,draft_posts=1,approved_posts=1,archived_posts=1,scheduled_posts=1,awaiting_publisher=0,blocked_schedules=0)
    assert len(data['upcoming_schedules'])==1 and data['upcoming_schedules'][0]['id']==str(row.id)
    assert data['publishing_available'] is data['analytics_available'] is False
    client.patch(root+f"/posts/{b['id']}",json=draft(revision=b['revision'],caption='Edited approved content',status='draft'))
    after=client.get(root+'/dashboard/summary').json()
    assert after['total_posts']==3 and after['draft_posts']==2 and after['blocked_schedules']==1 and after['scheduled_posts']==0
    assert after['recent_activity'][0]['event_type']=='blocked'


def test_awaiting_is_a_distinct_post_count_and_review_queue_is_bounded(client,setup,db):
    _,_,root=setup
    for i in range(8):saved(client,root,title=f'Review {i}')
    p=saved(client,root,title='Due approved post');p=client.post(root+f"/posts/{p['id']}/approve",json={'revision':p['revision']}).json()
    row=schedule(db,db.get(Post,UUID(p['id'])),scheduled_at=datetime.now(timezone.utc)+timedelta(seconds=.4))
    time.sleep(.5);row.status='awaiting_publisher';db.flush()
    data=client.get(root+'/dashboard/summary').json()
    assert data['awaiting_publisher']==1 and data['scheduled_posts']==0 and data['approved_posts']==1
    assert len(data['awaiting_approval'])==5 and len(data['recent_posts'])==6


def test_library_search_sort_pagination_dates_and_schedule_link(client,setup,db,owner):
    _,_,root=setup
    a=saved(client,root,title='First saved record');b=saved(client,root,title='Second saved record',caption='Search this specific text',platform='LinkedIn')
    db.get(Post,UUID(a['id'])).created_at=datetime.now(timezone.utc)-timedelta(days=1);db.flush()
    p=client.post(root+f"/posts/{b['id']}/approve",json={'revision':b['revision']}).json()
    row=schedule(db,db.get(Post,UUID(p['id'])))
    data=client.get(root+'/post-library?sort=created_asc&limit=1').json()
    assert data['total']==2 and data['items'][0]['id']==a['id'] and data['items'][0]['created_at']
    page=client.get(root+'/post-library?sort=created_asc&limit=1&offset=1').json()
    assert page['items'][0]['id']==b['id'] and page['items'][0]['schedule']['id']==str(row.id)
    assert page['items'][0]['asset_count']==0 and page['items'][0]['preview_asset_id'] is None
    # Metadata-only fixture in the rollback transaction; no provider/file mutation.
    image_job=AIJob(company_id=UUID(b['company_id']),requested_by=owner.id,kind='image_generation',
        request_key=uuid4(),status='completed',stage='completed',payload={},result={})
    db.add(image_job);db.flush()
    asset=PostAsset(company_id=UUID(b['company_id']),post_id=UUID(b['id']),job_id=image_job.id,
        storage_key=f'crm-rollback-{uuid4().hex}.png',mime_type='image/png',width=64,height=64,
        size_bytes=123,generation_model='fixture-no-provider')
    db.add(asset);db.flush()
    media=client.get(root+'/post-library?q=specific').json()['items'][0]
    assert media['asset_count']==1 and media['preview_asset_id']==str(asset.id)
    assert client.get(root+'/post-library?q=specific&platform=LinkedIn&status=approved').json()['total']==1
    assert client.get(root+'/post-library?q=%25').json()['total']==0
    assert client.get(root+'/post-library?sort=unsafe').status_code==422
    assert client.get(root+'/post-library?limit=101').status_code==422


def test_generation_history_separates_unsaved_results_and_saved_posts(client,setup,db,owner):
    c,_,root=setup
    brand=db.scalar(select(BrandProfile).where(BrandProfile.company_id==UUID(c['id'])))
    job=AIJob(company_id=UUID(c['id']),requested_by=owner.id,kind='content_generation',request_key=uuid4(),
        status='completed',stage='completed',payload={'request':{'topic':'Recovered generation'},'context':{'brand_revision':brand.revision},'private_internal':'do not expose'},
        result={'posts':[draft()], 'strategy':{},'warnings':[]})
    db.add(job);db.flush()
    history=client.get(root+'/generation-history').json()
    assert history['total']==1 and history['items'][0]['result_count']==1 and history['items'][0]['saved_results']==[]
    assert 'private_internal' not in str(history) and 'context' not in str(history)
    body=draft(creation_key=str(uuid4()),generation_job_id=str(job.id),result_index=0)
    post=client.post(root+'/posts',json=body).json()
    assert client.post(root+'/posts',json=body).json()['id']==post['id']
    recovered=client.get(root+'/generation-history').json()['items'][0]
    assert recovered['saved_results']==[{'result_index':0,'post_id':post['id']}]
    assert client.get(root+'/post-library').json()['total']==1


def test_directory_and_crm_are_tenant_scoped_and_member_readable(client,setup,db):
    c,w,root=setup;other=company(client,w['id'],name='Another client')
    foreign_w=workspace(client);foreign_c=company(client,foreign_w['id'])
    saved(client,root)
    directory=client.get(f"/api/v1/workspaces/{w['id']}/company-directory?q=Another").json()
    assert directory['total']==1 and directory['items'][0]['id']==other['id']
    assert directory['items'][0]['brand_confirmed'] is False
    user=User(full_name='Read only CRM',email=f'crm-{uuid4().hex}@example.com',hashed_password='unused')
    db.add(user);db.flush();db.add(WorkspaceMember(workspace_id=UUID(w['id']),user_id=user.id,role='member'));db.commit()
    client.cookies.set('access_token',create_access_token(user.id))
    for suffix in ['/dashboard/summary','/post-library','/generation-history']:
        assert client.get(root+suffix).status_code==200
        assert client.get(f"/api/v1/companies/{foreign_c['id']}"+suffix).status_code==404
    assert client.get(f"/api/v1/workspaces/{foreign_w['id']}/company-directory").status_code==404
    client.cookies.clear();assert client.get(root+'/dashboard/summary').status_code==401


def test_library_query_count_does_not_grow_per_post(client,setup,db):
    _,_,root=setup
    for i in range(12):saved(client,root,title=f'Indexed post {i}')
    queries=[]
    def capture(connection,cursor,statement,*args):queries.append(statement)
    event.listen(db.bind,'before_cursor_execute',capture)
    try:
        assert len(client.get(root+'/post-library?limit=12').json()['items'])==12
    finally:event.remove(db.bind,'before_cursor_execute',capture)
    # Auth + membership + authorization + total + bounded projection; no per-post reads.
    assert len(queries)<=9
    assert not any(q.lstrip().upper().startswith(('INSERT','UPDATE','DELETE')) for q in queries)
    queries.clear()
    event.listen(db.bind,'before_cursor_execute',capture)
    try:
        for path in [root+'/dashboard/summary',root+'/generation-history',
            f"/api/v1/workspaces/{setup[1]['id']}/company-directory"]:
            assert client.get(path).status_code==200
    finally:event.remove(db.bind,'before_cursor_execute',capture)
    assert not any(q.lstrip().upper().startswith(('INSERT','UPDATE','DELETE')) for q in queries)
