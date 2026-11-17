import asyncio
import io
import json
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock
import pytest
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import select
from app.models.content import Post,PostAsset
from app.models.intelligence import AIJob
from app.schemas.content import ContentDraft,GeneratedContent
from app.services.content_generation import strategy,validate_quality,generate,wire_schema
from app.services.media_storage import LocalMediaStorage,validate_image,GoogleImageProvider
from app.services.extraction_errors import ExtractionError
from app.services import ai_queue
from app.core.intelligence_config import ai_settings
from app.workers.intelligence import run_job
from test_onboarding import owner,workspace,company


@pytest.fixture
def setup(client,owner):
    c=company(client,workspace(client)['id']);root=f"/api/v1/companies/{c['id']}"
    client.post(root+'/brand/confirm',json={'revision':1})
    return c,root


def draft(**changes):
    return {'title':'A thoughtful introduction','platform':'Instagram','content_type':'text',
        'caption':'Meet our team and explore thoughtful ideas.','hashtags':['#Ideas'],'hook':'Meet our team',
        'call_to_action':'Share your thoughts','image_prompt':'A conceptual illustration','slides':[],**changes}


def test_schema_platform_hashtags_and_carousel():
    assert 'title' in wire_schema()['$defs']['ContentDraft']['properties']
    for change in ({'hashtags':['#One','#one']},{'hashtags':['not a tag']},{'platform':'X','caption':'界'*150},{'content_type':'carousel'}):
        with pytest.raises(ValidationError):ContentDraft(**draft(**change))
    ContentDraft(**draft(content_type='carousel',slides=[{'heading':'Intro','body':'Our approach','visual':'Abstract forms'}]*2))


def test_strategy_preferences_claims_and_alignment():
    context={'company_name':'Engineering','industry':'Software','products_services':['Engineering'],'preferences':{'goals':['Education'],'language':'Hindi','tones':['Warm'],'excluded_topics':['Politics']}}
    request={'topic':'Software','platforms':['Instagram'],'content_type':'text'}
    assert strategy(context,request)['language']=='Hindi'
    for caption in ['Engineering saves 90% today','Award-winning Engineering','Engineering discusses Politics','Nothing relevant here']:
        with pytest.raises(ValueError):validate_quality(GeneratedContent(posts=[ContentDraft(**draft(caption=caption))]),context,request)
    assert validate_quality(GeneratedContent(posts=[ContentDraft(**draft(caption='Explore Engineering ideas'))]),context,request)


def test_certification_failure_gets_actionable_retry_without_echoing_rejected_copy():
    context={'company_name':'Bakingo','industry':'Bakery','products_services':['Cakes'],'preferences':{}}
    request={'topic':'cakes','platforms':['Instagram'],'content_type':'image'}
    rejected=draft(content_type='image',caption='Bakingo certified cakes for your celebrations.')
    accepted=draft(content_type='image',caption='Celebrate with Bakingo cakes. Message us to explore cake designs.')
    mock=AsyncMock(side_effect=[SimpleNamespace(text=json.dumps({'posts':[rejected]}),usage_metadata=None),SimpleNamespace(text=json.dumps({'posts':[accepted]}),usage_metadata=None)])
    client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock)))
    result,_=asyncio.run(generate(client,{'context':context,'request':request}))
    assert mock.await_count==2
    correction=mock.call_args_list[1].kwargs['contents']
    assert 'Do not say certified' in correction
    assert rejected['caption'] not in correction
    assert result['posts'][0]['caption']==accepted['caption']
    with pytest.raises(ValueError,match='Unsupported promotional assertion'):
        validate_quality(GeneratedContent(posts=[ContentDraft(**rejected)]),context,request)


def test_confirmed_named_certification_is_allowed_but_an_invented_one_is_not():
    context={'company_name':'Bakingo','description':'An FSSAI certified bakery.','industry':'Bakery','products_services':['Cakes'],'preferences':{}}
    request={'topic':'cakes','platforms':['Instagram'],'content_type':'image'}
    valid=draft(content_type='image',caption='Explore cakes from Bakingo, an FSSAI-certified bakery.')
    assert validate_quality(GeneratedContent(posts=[ContentDraft(**valid)]),context,request)
    for caption in ['Bakingo certified cakes for every celebration.','Bakingo offers ISO-certified cakes.']:
        with pytest.raises(ValueError,match='Unsupported promotional assertion'):
            validate_quality(GeneratedContent(posts=[ContentDraft(**{**valid,'caption':caption})]),context,request)


def test_crud_idempotency_revision_archive_approval(client,setup):
    c,root=setup;body=draft(creation_key=str(uuid4()))
    created=client.post(root+'/posts',json=body);assert created.status_code==201,created.text
    post=created.json();path=root+'/posts/'+post['id']
    assert client.post(root+'/posts',json=body).json()['id']==post['id']
    data={**draft(caption='Edited caption'),'revision':post['revision'],'status':'draft'}
    updated=client.patch(path,json=data);assert updated.status_code==200,updated.text
    assert client.patch(path,json=data).status_code==409
    post=updated.json()
    approved=client.post(path+'/approve',json={'revision':post['revision']});assert approved.json()['status']=='approved'
    post=approved.json()
    assert client.patch(path,json={**data,'revision':post['revision'],'status':'approved','caption':'A new edit'}).status_code==422
    archived=client.patch(path,json={**draft(caption=post['caption']),'revision':post['revision'],'status':'archived'}).json()
    assert archived['status']=='archived'
    restored=client.patch(path,json={**draft(caption=post['caption']),'revision':archived['revision'],'status':'draft'}).json()
    assert restored['status']=='draft'
    key={'request_key':str(uuid4())};copy=client.post(path+'/duplicate',json=key).json()
    assert copy['id']!=post['id'] and client.post(path+'/duplicate',json=key).json()['id']==copy['id']
    assert len(client.get(root+'/posts?q=Edited&platform=Instagram&status=draft').json())==2


def test_tenant_and_unavailable_images(client,setup,monkeypatch):
    _,root=setup;post=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
    other='/api/v1/companies/'+str(uuid4())
    assert client.get(other+'/posts/'+post['id']).status_code==404
    assert client.patch(other+'/posts/'+post['id'],json={**draft(),'revision':1}).status_code==404
    assert client.get(other+'/media/'+str(uuid4())).status_code==404
    monkeypatch.setattr(ai_settings,'gemini_image_model',None)
    assert client.post(root+'/posts/'+post['id']+'/images',json={'request_key':str(uuid4())}).status_code==503


def test_unconfirmed_and_context_without_competitors(client,owner):
    c=company(client,workspace(client)['id']);root=f"/api/v1/companies/{c['id']}"
    data={'request_key':str(uuid4()),'platforms':['Instagram'],'content_type':'text','topic':'Introduction'}
    assert client.post(root+'/content-generations',json=data).status_code==422
    client.post(root+'/brand/confirm',json={'revision':1})
    assert client.post(root+'/content-generations',json=data).status_code==202


def test_generation_worker_raw_result_and_save_preserves_edits(client,setup,db,monkeypatch):
    c,root=setup
    body={'request_key':str(uuid4()),'platforms':['Instagram'],'content_type':'text','topic':'Introduction'}
    response=client.post(root+'/content-generations',json=body);assert response.status_code==202,response.text
    job=db.get(AIJob,response.json()['id']);name=job.payload['context']['company_name']
    generated=draft(caption='Meet '+name+' and explore our approach.')
    mock=AsyncMock(return_value=SimpleNamespace(text=json.dumps({'posts':[generated]}),usage_metadata=None))
    analyzer=SimpleNamespace(client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock))))
    @contextmanager
    def factory():yield db
    claim=ai_queue.claim(db,company_id=c['id']);asyncio.run(run_job(claim,analyzer,factory))
    result=client.get(root+'/content-generations/'+str(job.id)+'/result');assert result.status_code==200,result.text
    saved=client.post(root+'/posts',json={**generated,'creation_key':str(uuid4()),'generation_job_id':str(job.id),'result_index':0})
    assert saved.status_code==201,saved.text
    post=saved.json()
    client.patch(root+'/posts/'+post['id'],json={**generated,'caption':'My reviewed edit','revision':1})
    assert client.get(root+'/content-generations/'+str(job.id)+'/result').json()['posts'][0]['caption']==generated['caption']
    replay=client.post(root+'/posts',json={**generated,'creation_key':str(uuid4()),'generation_job_id':str(job.id),'result_index':0})
    assert replay.json()['caption']=='My reviewed edit'
    regeneration=client.post(root+'/posts/'+post['id']+'/regenerate',json={'request_key':str(uuid4())})
    assert regeneration.status_code==202 and client.get(root+'/posts/'+post['id']).json()['caption']=='My reviewed edit'


def test_model_invalid_output_bounded_repair():
    mock=AsyncMock(return_value=SimpleNamespace(text='{}',usage_metadata=None))
    context={'company_name':'Test','products_services':[],'preferences':{}}
    request={'topic':'Intro','platforms':['Instagram'],'content_type':'text'}
    with pytest.raises(ExtractionError) as error:asyncio.run(generate(SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock))),{'context':context,'request':request}))
    assert mock.await_count==2 and error.value.code=='content_validation_failed'


def image_bytes():
    data=io.BytesIO();Image.new('RGB',(128,128),'pink').save(data,format='PNG');return data.getvalue()


def test_private_storage_validation_and_traversal(tmp_path):
    store=LocalMediaStorage(tmp_path);key,metadata=store.save(uuid4(),uuid4(),image_bytes(),'image/png')
    assert metadata['width']==128 and store.path(key).is_file()
    for invalid in ('../../.env','/etc/passwd',key+'/../test'):
        with pytest.raises(ExtractionError):store.path(invalid)
    for data,mime in ((b'<svg/>','image/svg+xml'),(b'bad','image/png'),(image_bytes(),'image/jpeg')):
        with pytest.raises(ExtractionError):validate_image(data,mime)
    store.remove(key);assert not store.path(key).exists()


def test_image_worker_storage_and_authorized_retrieval(client,setup,db,monkeypatch,tmp_path):
    c,root=setup
    monkeypatch.setattr(ai_settings,'gemini_image_model','test-image-model');monkeypatch.setattr(ai_settings,'media_root',tmp_path)
    post=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
    response=client.post(root+'/posts/'+post['id']+'/images',json={'request_key':str(uuid4())});assert response.status_code==202,response.text
    monkeypatch.setattr(GoogleImageProvider,'generate',AsyncMock(return_value=(image_bytes(),'image/png')))
    @contextmanager
    def factory():yield db
    asyncio.run(run_job(ai_queue.claim(db,company_id=c['id']),SimpleNamespace(client=None),factory))
    assets=client.get(root+'/posts/'+post['id']+'/assets').json();assert len(assets)==1
    retrieved=client.get(root+'/media/'+assets[0]['id']);assert retrieved.status_code==200
    assert retrieved.headers['content-type']=='image/png' and 'no-store' in retrieved.headers['cache-control']
    assert client.get('/api/v1/companies/'+str(uuid4())+'/media/'+assets[0]['id']).status_code==404


def test_cancel_fences_running_job(client,setup,db):
    c,root=setup
    job=client.post(root+'/content-generations',json={'request_key':str(uuid4()),'platforms':['Instagram'],'topic':'Introduction'}).json()
    job_id,token=ai_queue.claim(db,company_id=c['id'])
    cancelled=client.post(root+'/ai-jobs/'+job['id']+'/cancel')
    assert cancelled.status_code==200 and cancelled.json()['status']=='cancelled'
    assert ai_queue.leased(db,job_id,token) is None


def test_real_foreign_user_cannot_access_saved_content(client,setup,db):
    from app.models.user import User
    from app.core.security import create_access_token
    _,root=setup
    post=client.post(root+'/posts',json=draft(creation_key=str(uuid4()))).json()
    other=User(full_name='Other content user',email=f'{uuid4()}@example.com',hashed_password='unused',is_active=True)
    db.add(other);db.commit();client.cookies.set('access_token',create_access_token(other.id))
    for path in ('/posts','/posts/'+post['id'],'/posts/'+post['id']+'/assets','/media/'+str(uuid4())):
        assert client.get(root+path).status_code==404
    assert client.patch(root+'/posts/'+post['id'],json={**draft(),'revision':1}).status_code==404
    assert client.post(root+'/content-generations',json={'request_key':str(uuid4()),'platforms':['Instagram'],'topic':'Introduction'}).status_code==404
