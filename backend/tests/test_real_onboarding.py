import asyncio,io
from uuid import uuid4
import httpx,pytest
from PIL import Image
from app.services.website_fetcher import canonical_redirect_allowed,WebsiteFetcher
from app.services.website_extraction import extract_website
from app.services.extraction_errors import ExtractionError
from app.api.brand_media import clean_logo
from app.core.intelligence_config import ai_settings
from app.core.security import create_access_token
from app.models.user import User
from test_onboarding import owner,workspace,company
from test_website_extraction import fetcher,response,HTML
from sqlalchemy import select
from app.models.intelligence import AIJob


def test_brand_import_rediscovers_wordmark_and_custom_site_palette(client, db, owner, tmp_path, monkeypatch):
    from app.api import brand_media
    from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult

    monkeypatch.setattr(ai_settings, 'media_root', tmp_path)
    url = 'https://example-studio.org/'
    created = company(client, workspace(client)['id'], website_url=url)
    root = f"/api/v1/companies/{created['id']}"
    job = BrandExtractionJob(company_id=created['id'], requested_by=owner.id, requested_url=url, status='completed', stage='completed')
    db.add(job)
    db.flush()
    db.add(BrandExtractionResult(company_id=created['id'], job_id=job.id, extracted_data={}, source_evidence=[],
                                 source_pages=[{'url': url, 'stylesheet_urls': [url + 'app.css']}], warnings=[], model_identifier='test'))
    db.commit()

    def handler(request):
        path = request.url.path
        if path == '/robots.txt':
            return response(b'User-agent: *\nAllow: /', mime='text/plain')
        if path == '/app.css':
            return response(b':root{--studio-current:#1a5270;--studio-paper:rgb(245, 235, 214);--color-red-500:#ef4444} '
                            b'nav{color:var(--studio-current);background:var(--studio-paper)}', mime='text/css')
        if path == '/nav/wordmark_dark.svg':
            return response(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><rect width="60" height="30" fill="#1a5270"/></svg>', mime='image/svg+xml')
        assert path == '/'
        return response(b'<header><img aria-hidden="true" src="/nav/logo_hidden.svg">'
                        b'<img src="/nav/wordmark_dark.svg" alt="Studio home"></header><link rel="stylesheet" href="/app.css">')

    monkeypatch.setattr(brand_media, 'WebsiteFetcher', lambda: fetcher(handler))
    result = client.post(root + '/brand/logo/auto', params={'job_id': str(job.id), 'revision': 1, 'draft_only': True})
    assert result.is_success, result.text
    assert result.json()['brand_colors'] == ['#1a5270', '#f5ebd6']
    assert client.get(root + '/brand/logo').headers['content-type'] == 'image/svg+xml'
    brand = client.post(root + '/brand/confirm', json={'revision': result.json()['brand_revision']}).json()
    retry = client.post(root + '/brand/logo/auto', params={'job_id': str(job.id), 'revision': brand['revision'], 'draft_only': True})
    assert retry.json()['brand_revision'] == brand['revision']
    assert client.get(root + '/brand').json()['is_confirmed']

@pytest.mark.parametrize('target',['https://www.business.org/','https://business.org/'])
def test_safe_canonical_redirects_and_destination_robots(target):
    calls=[]
    def handler(req):
        calls.append(str(req.url))
        if req.url.path=='/robots.txt':return response(b'User-agent: *\nAllow: /',mime='text/plain')
        if req.url.scheme=='http':return response(status=301,location=target)
        return response(HTML)
    result=asyncio.run(extract_website('http://business.org',fetcher=fetcher(handler)))
    assert result['resolved_url']==target and target+'robots.txt' in calls

@pytest.mark.parametrize('target',['http://www.business.org/','https://other.org/','https://sub.business.org/','http://127.0.0.1/'])
def test_unsafe_canonical_alias_or_downgrade_rejected(target):
    assert not canonical_redirect_allowed('https://business.org/',target)

def test_canonical_destination_robots_disallow_is_not_fetched():
    calls=[]
    def handler(req):
        calls.append(str(req.url))
        if req.url.path=='/robots.txt':return response(b'User-agent: *\nDisallow: /' if req.url.host.startswith('www.') else b'User-agent: *\nAllow: /',mime='text/plain')
        return response(status=301,location='https://www.business.org/')
    with pytest.raises(ExtractionError):asyncio.run(extract_website('https://business.org',fetcher=fetcher(handler)))
    assert 'https://www.business.org/' not in calls

@pytest.mark.parametrize('payload',[b'<svg><script>alert(1)</script></svg>',b'<svg><image href="http://127.0.0.1"/></svg>',b'<!DOCTYPE svg><svg/>',b'<svg onload="evil()"/>',b'<svg xml:base="https://evil.org"><use href="#x"/></svg>'])
def test_active_logo_files_rejected(payload):
    with pytest.raises(ExtractionError):clean_logo(payload,'image/svg+xml')

def test_private_logo_upload_revision_persistence_and_tenant(client,db,owner,tmp_path,monkeypatch):
    monkeypatch.setattr(ai_settings,'media_root',tmp_path)
    c=company(client,workspace(client)['id']);root=f"/api/v1/companies/{c['id']}"
    raw=io.BytesIO();Image.new('RGB',(32,32),'red').save(raw,format='PNG')
    uploaded=client.post(root+'/brand/logo/upload?revision=1',content=raw.getvalue(),headers={'Content-Type':'image/png'})
    assert uploaded.status_code==200,uploaded.text
    logo=client.get(root+'/brand/logo')
    assert logo.status_code==200 and logo.headers['cache-control']=='private, no-store'
    assert client.get(root+'/brand').json()['logo_url']==uploaded.json()['logo_url']
    assert client.post(root+'/brand/logo/upload?revision=1',content=raw.getvalue(),headers={'Content-Type':'image/png'}).status_code==409
    other=User(full_name='Other logo tenant',email=f'{uuid4()}@example.com',hashed_password=owner.hashed_password);db.add(other);db.commit()
    client.cookies.set('access_token',create_access_token(other.id))
    assert client.get(root+'/brand/logo').status_code==404
    assert client.post(root+'/brand/logo/from-website',params={'job_id':str(uuid4()),'revision':2}).status_code==404


@pytest.mark.parametrize('inline', [False, True])
def test_completed_analysis_imports_real_logo_and_blank_palette(client, db, owner, tmp_path, monkeypatch, inline):
    from app.api import brand_media
    from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult

    monkeypatch.setattr(ai_settings, 'media_root', tmp_path)
    c = company(client, workspace(client)['id'])
    root = f"/api/v1/companies/{c['id']}"
    website = 'https://business.org/'
    assert client.patch(root, json={'revision': c['revision'], 'website_url': website}).status_code == 200
    job = BrandExtractionJob(company_id=c['id'], requested_by=owner.id, requested_url=website, status='completed', stage='completed')
    db.add(job)
    db.flush()
    db.add(BrandExtractionResult(company_id=c['id'], job_id=job.id, extracted_data={}, source_evidence=[], source_pages=[], warnings=[], model_identifier='test'))
    db.commit()

    image = Image.new('RGBA', (160, 64), (0, 0, 0, 0))
    image.paste('#b13462', (48, 8, 112, 56))
    body = io.BytesIO()
    image.save(body, 'PNG')
    marker = '<svg viewBox="0 0 160 64"><rect width="160" height="64" fill="#b13462"/></svg>' if inline else '<img srcset="https://assets.business.org/mark.png 2x" alt="Acme">'
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == '/robots.txt':
            return response(b'User-agent: *\nAllow: /', mime='text/plain')
        if request.url.path == '/brand.css':
            return response(b':root { --brand-primary: #164e8d; --accent: #fc9; }', mime='text/css')
        if request.url.path == '/mark.png':
            return response(body.getvalue(), mime='image/png')
        return response(f'<link rel="stylesheet" href="/brand.css"><a class="navbar-brand" href="/">{marker}</a>'.encode())

    monkeypatch.setattr(brand_media, 'WebsiteFetcher', lambda: fetcher(handler))
    imported = client.post(root + '/brand/logo/auto', params={'job_id': str(job.id), 'revision': 1})
    assert imported.status_code == 200, imported.text
    assert imported.json()['brand_colors'] == ['#164e8d', '#ffcc99', '#b13462']
    brand = client.get(root + '/brand').json()
    assert brand['logo_url'] == imported.json()['logo_url']
    assert brand['brand_colors'] == imported.json()['brand_colors']
    assert client.get(root + '/brand/logo').headers['content-type'] == ('image/svg+xml' if inline else 'image/png')
    assert ('/mark.png' in calls) is not inline
    assert client.post(root + '/brand/logo/auto', params={'job_id': str(job.id), 'revision': 1}).status_code == 409
    count = len(calls)
    repeated = client.post(root + '/brand/logo/auto', params={'job_id': str(job.id), 'revision': brand['revision']})
    assert repeated.status_code == 200 and repeated.json()['logo_url'] == brand['logo_url']
    assert repeated.json()['brand_colors'] == brand['brand_colors'] and len(calls) == count


def test_website_change_replaces_old_imported_logo_and_removes_only_old_guidelines(client, db, owner, tmp_path, monkeypatch):
    from app.api import brand_media
    from app.models.brand_extraction import BrandExtractionJob, BrandExtractionResult
    from app.models.brand_logo import BrandLogo
    from app.models.onboarding import Company

    monkeypatch.setattr(ai_settings, 'media_root', tmp_path)
    record = company(client, workspace(client)['id'])
    root = f"/api/v1/companies/{record['id']}"
    item = db.get(Company, record['id'])
    item.website_url = 'https://old-brand.org/'
    old_url = 'https://assets.example.org/old.svg'
    new_url = 'https://assets.example.org/new.svg'

    def completed(url, asset_url, proposition):
        job = BrandExtractionJob(company_id=item.id, requested_by=owner.id, requested_url=url, status='completed', stage='completed')
        db.add(job)
        db.flush()
        db.add(BrandExtractionResult(company_id=item.id, job_id=job.id, extracted_data={'value_proposition': proposition},
            source_pages=[{'url': url, 'logo_candidates': [{'url': asset_url, 'reason': 'explicit website logo'}]}],
            source_evidence=[], warnings=[], model_identifier='test'))
        db.commit()
        return job.id

    old_job = completed(item.website_url, old_url, 'Software development')
    svg = b'<svg viewBox="0 0 120 40"><rect width="120" height="40" fill="#b13462"/></svg>'
    imported = brand_media.save_logo(db, item, clean_logo(svg, 'image/svg+xml'), item.brand.revision, old_url)
    old_logo = imported['logo_url']
    item.brand.brand_colors = ['#112233']
    item.brand.content_guidelines = 'Use a warm tone.\nValue proposition: Software development\nValue proposition: Cakes for celebrations'
    db.commit()

    new_website = 'https://new-brand.org/'
    updated = client.patch(root, json={'revision': item.revision, 'website_url': new_website})
    assert updated.status_code == 200, updated.text
    assert client.get(root + '/brand').json()['logo_url'] is None
    assert client.get(root + '/brand/logo').status_code == 404
    assert client.post(root + '/brand/logo/from-website', params={'job_id': str(old_job), 'revision': item.brand.revision}).status_code == 409

    # Simulate a company changed before website changes detached the old logo.
    item.brand.logo_url = old_logo
    db.commit()
    job_id = completed(new_website, new_url, 'Cakes for celebrations')

    def handler(request):
        if request.url.path == '/robots.txt':
            return response(b'User-agent: *\nAllow: /', mime='text/plain')
        assert str(request.url) == new_url
        return response(svg, mime='image/svg+xml')

    monkeypatch.setattr(brand_media, 'WebsiteFetcher', lambda: fetcher(handler))
    logo = client.post(root + '/brand/logo/auto', params={'job_id': str(job_id), 'revision': item.brand.revision})
    assert logo.status_code == 200, logo.text
    assert logo.json()['logo_url'] != old_logo
    assert db.get(BrandLogo, item.id).source_url == new_url
    assert client.get(root + '/brand').json()['content_guidelines'] == 'Use a warm tone.\nValue proposition: Cakes for celebrations'
    assert logo.json()['brand_colors'] == ['#112233']

def test_latest_preferences_enter_real_generation_snapshot(client,db,owner):
    c=company(client,workspace(client)['id']);root=f"/api/v1/companies/{c['id']}"
    assert client.post(root+'/brand/confirm',json={'revision':1}).status_code==200
    prefs={'revision':1,'platforms':['instagram','linkedin'],'content_goals':['lead_generation'],'tone':['professional'],'content_formats':['educational'],'target_audience':'Technology procurement teams','content_topics':['Secure software'],'excluded_topics':['Discounts'],'visual_style':'Clean diagrams with blue accents','language':'english','custom_instructions':'Explain the process clearly'}
    assert client.put(root+'/preferences',json=prefs).status_code==200
    job=client.post(root+'/content-generations',json={'request_key':str(uuid4()),'platforms':['Instagram','LinkedIn'],'content_type':'educational','topic':'Our software process','include_images':False})
    assert job.status_code==202,job.text
    snapshot=db.get(AIJob,job.json()['id']).payload
    assert snapshot['context']['target_audience']==prefs['target_audience']
    assert snapshot['context']['preferences']['topics']==['Secure software']
    assert snapshot['context']['preferences']['visual_style']==prefs['visual_style']
    assert snapshot['context']['preferences']['excluded_topics']==['Discounts']
    assert snapshot['context']['competitor_insights']==[]
    assert snapshot['request']['platforms']==['Instagram','LinkedIn']


def test_real_completion_requires_generated_post_and_does_not_mark_demo(client,db,owner):
    from app.models.content import Post
    from test_onboarding import complete_step,resource
    from test_content import draft
    c=company(client,workspace(client)['id']);root=f"/api/v1/companies/{c['id']}"
    client.post(root+'/brand/confirm',json={'revision':1})
    response=client.put(root+'/preferences',json={'revision':1,'platforms':['instagram'],'content_goals':['lead_generation'],'tone':['professional'],'content_formats':['educational']})
    assert response.status_code==200,response.text
    for step in ['business','brand','competitors','preferences']:
        response=complete_step(client,c['id'],step)
        assert response.status_code==200,response.text
    assert complete_step(client,c['id'],'generate').status_code==422
    manual=client.post(root+'/posts',json={**draft(),'creation_key':str(uuid4())})
    assert manual.status_code==201,manual.text
    assert complete_step(client,c['id'],'generate').status_code==422
    queued=client.post(root+'/content-generations',json={'request_key':str(uuid4()),'platforms':['Instagram'],'content_type':'text','topic':'Our company'})
    assert queued.status_code==202,queued.text
    job=db.get(AIJob,queued.json()['id']);job.status='completed';job.result={'posts':[draft()]}
    post=db.get(Post,manual.json()['id']);post.generation_job_id=job.id;post.result_index=0;db.commit()
    assert complete_step(client,c['id'],'generate').status_code==200
    progress=resource(client,c['id'],'onboarding')
    done=client.post(root+'/onboarding/complete',json={'revision':progress['revision']})
    assert done.status_code==200,done.text
    assert done.json()['status']=='completed' and done.json()['demo_completed'] is False
    assert done.json()['demo_steps']==[]


def test_static_svg_logo_color_css_is_allowed_but_remote_css_is_rejected():
    raw=b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><style>.brand {fill:#123456;}</style><path class="brand" d="M0 0h20v20z"/></svg>'
    _,metadata,colors=clean_logo(raw,'image/svg+xml')
    assert metadata['width']==120 and '#123456' in colors
    with pytest.raises(ExtractionError):clean_logo(raw.replace(b'fill:#123456',b'fill:url(https://example.com/x)'),'image/svg+xml')


def test_generation_wire_contract_requires_every_draft_field():
    from app.services.content_generation import wire_schema
    schema=wire_schema()['$defs']['ContentDraft']
    assert set(schema['required'])==set(schema['properties'])


def test_social_and_contact_evidence_survives_large_page_passage_budget():
    from app.services.gemini_brand_analyzer import analysis_sources
    source='https://www.linkedin.com/company/example'
    website={'pages':[{'url':'https://business.org','cleaned_text':'\n'.join('Paragraph '+str(i) for i in range(180)),'contacts':['hello@business.org'],'social_links':{'linkedin':source}}]}
    passages=analysis_sources(website)
    assert len(passages)==120
    assert {'hello@business.org',source}.issubset({v['text'] for v in passages.values()})
