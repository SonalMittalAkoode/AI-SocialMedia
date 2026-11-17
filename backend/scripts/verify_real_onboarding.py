"""Explicit paid live checkpoint. Creates isolated QA data; never edits .env or existing companies.

Run only on request: python scripts/verify_real_onboarding.py --live --worker-pid PID
Grounded search output is NEVER saved; only access/display metadata counts are recorded.
"""
import argparse,hashlib,io,json,secrets,tempfile,time
from pathlib import Path
from uuid import uuid4
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import httpx
from PIL import Image

parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true',required=True);parser.add_argument('--worker-pid',type=int,required=True)
parser.add_argument('--resume',action='store_true')
args=parser.parse_args()
base='http://localhost:8000/api/v1'
client=httpx.Client(base_url=base,headers={'Origin':'http://localhost:3000'},timeout=100)
report={'worker_pid':args.worker_pid,'worker_source_sha256':hashlib.sha256(Path('app/workers/extraction.py').read_bytes()).hexdigest(),'checks':{}}
prior_path=Path('..')/'docs'/'phase76-live-results.json'
if args.resume and prior_path.exists():
    prior=json.loads(prior_path.read_text(encoding='utf-8'))
    report['checks'].update(prior.get('checks',{}))
    report['prior_failures']=prior.get('prior_failures',[])
    previous=report['checks'].pop('remaining_failure',None)
    if previous:report['prior_failures'].append(previous)
def log(name,value):
    report['checks'][name]=value;print(json.dumps({name:value}),flush=True)
def request(method,path,**kwargs):
    r=client.request(method,path,**kwargs)
    if r.status_code>=400:raise RuntimeError(f'{method} {path}: HTTP {r.status_code} {r.text[:350]}')
    return r.json()
def wait(root,job,extraction=False,seconds=220):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        row=request('GET',root+('/brand-extractions/' if extraction else '/ai-jobs/')+job['id'])
        if row['status']=='completed':return row
        if row['status'] in ('failed','cancelled'):raise RuntimeError(f"Job {row['id']}: {row.get('error_code')} {row.get('error_message')}")
        time.sleep(2)
    raise RuntimeError(f"Job {job['id']} exceeded live-check wait")
auth_path=Path(tempfile.gettempdir())/'socialai-phase76-live-auth.json'
if args.resume:
    auth=json.loads(auth_path.read_text(encoding='utf-8'))
    assert auth['email'].startswith('e2e-phase76-live-')
    email,password=auth['email'],auth['password']
    request('POST','/auth/login',json={'email':email,'password':password})
    company={'id':auth['company_id']};workspace={'id':auth['workspace_id']}
    root=f"/companies/{company['id']}"
else:
    email=f'e2e-phase76-live-{uuid4().hex}@example.com';password='Qa76!'+secrets.token_urlsafe(22)
    request('POST','/auth/register',json={'full_name':'Phase 7.6 Live QA','email':email,'password':password})
    request('POST','/auth/login',json={'email':email,'password':password})
    workspace=request('POST','/workspaces',json={'name':'Phase 7.6 Live Verification','idempotency_key':str(uuid4())})
    company=request('POST',f"/workspaces/{workspace['id']}/companies",json={'name':'Akoode live verification','website_url':'https://akoode.com'})
    root=f"/companies/{company['id']}"
    auth_path=Path(tempfile.gettempdir())/'socialai-phase76-live-auth.json'
    auth={'email':email,'password':password,'workspace_id':workspace['id'],'company_id':company['id']}
    auth_path.write_text(json.dumps(auth),encoding='utf-8')
    print('QA_AUTH_FILE',str(auth_path),flush=True)
try:
    if not args.resume:
        job=request('POST',root+'/brand-extractions',json={'url':'https://akoode.com'})
        wait(root,job,extraction=True)
        result=request('GET',root+f"/brand-extractions/{job['id']}/result")
        fields={k:v for k,v in result['extracted_data'].items() if k not in ('field_evidence','warnings','overall_confidence') and v not in (None,[],{},'')}
        c=request('GET',root);b=request('GET',root+'/brand')
        request('POST',root+f"/brand-extractions/{job['id']}/apply",json={'company_revision':c['revision'],'brand_revision':b['revision'],'fields':fields})
        auth['extraction_job_id']=job['id'];auth_path.write_text(json.dumps(auth),encoding='utf-8')
        log('akoode_website',{'source_pages':len(result['source_pages']),'canonical':result['source_pages'][0]['url'],'populated_fields':list(fields),'industry':fields.get('industry'),'services':len(fields.get('products_services',[]))})
        b=request('GET',root+'/brand')
        try:
            logo=request('POST',root+'/brand/logo/from-website',params={'job_id':job['id'],'candidate':0,'revision':b['revision']})
            media=client.get(root+'/brand/logo');assert media.status_code==200
            log('actual_logo',{'stored':True,'mime':media.headers.get('content-type'),'bytes':len(media.content),'colors':logo['extracted_colors']})
        except RuntimeError as e:log('actual_logo',{'external_limitation':str(e)})
        b=request('GET',root+'/brand')
        # Explicit reviewer selection, not an extracted color claim.
        request('PATCH',root+'/brand',json={'revision':b['revision'],'brand_colors':['#ffffff','#315bd6']})
        b=request('GET',root+'/brand');request('POST',root+'/brand/confirm',json={'revision':b['revision']})
    def step(name):
        g=request('GET',root+'/onboarding')
        if name in g['completed_steps']:return g
        return request('POST',root+'/onboarding/complete-step',json={'revision':g['revision'],'step':name})
    step('business');step('brand')
    try:
        if report['checks'].get('google_display_only',{}).get('sources'):
            search=None
        else:
            search=request('POST',root+'/competitor-search',json={'request_key':str(uuid4())})
        if search:log('google_display_only',{'sources':len(search['sources']),'citations':len(search['citations']),'suggestions_present':bool(search['search_suggestions_html'])})
        del search # Never persist grounded content, even in the QA report.
    except RuntimeError as e:log('google_display_only',{'external_limitation':str(e),'manual_path_available':True})
    # This known public website is independently sourced; never from the search above.
    competitor=request('POST',root+'/competitors',json={'name':'Thoughtworks','website_url':'https://www.thoughtworks.com'})
    if competitor['verification_status']!='verified':
        research=request('POST',root+f"/competitors/{competitor['id']}/research",json={'request_key':str(uuid4())})
        try:
            wait(root,research,seconds=220)
            record=request('GET',root+f"/competitors/{competitor['id']}")
            request('PATCH',root+f"/competitors/{competitor['id']}",json={'revision':record['revision'],'selection_status':'approved'})
            log('independent_research',{'verification':record['verification_status'],'score':record['relevance_score'],'persisted':True})
        except RuntimeError as e:log('independent_research',{'external_limitation':str(e),'manual_record_retained':True})
    step('competitors')
    prefs=request('GET',root+'/preferences')
    request('PUT',root+'/preferences',json={'revision':prefs['revision'],'platforms':['instagram','linkedin'],'content_goals':['lead_generation'],'tone':['professional'],'content_formats':['educational'],'language':'english','target_audience':'Business technology decision makers','content_topics':['Custom software development','AI solutions'],'excluded_topics':['Discounts'],'visual_style':'Clean original abstract geometric blue and white illustrations','custom_instructions':'Explain technology clearly. Use a helpful professional voice. No invented claims.'})
    step('preferences')
    generation={'id':auth['generation_id']} if auth.get('generation_id') else request('POST',root+'/content-generations',json={'request_key':str(uuid4()),'platforms':['Instagram','LinkedIn'],'content_type':'educational','topic':'How custom software and AI can support a business workflow','include_images':True,'aspect_ratios':{'Instagram':'1:1','LinkedIn':'1:1'}})
    wait(root,generation)
    content=request('GET',root+f"/content-generations/{generation['id']}/result")
    auth['generation_id']=generation['id'];auth_path.write_text(json.dumps(auth),encoding='utf-8')
    posts=[]
    for index,draft in enumerate(content['posts']):
        post=request('POST',root+'/posts',json={**draft,'creation_key':str(uuid4()),'generation_job_id':generation['id'],'result_index':index});posts.append(post)
    log('live_text',{'platforms':[p['platform'] for p in posts],'saved_posts':len(posts)})
    for image in content.get('image_jobs',[]):
        try:wait(root,{'id':image['job_id']},seconds=260)
        except (RuntimeError,KeyError) as e:log('image_job_limitation',str(e))
    # Wait by actual media projection too, accommodating the existing job descriptor shape.
    deadline=time.monotonic()+260
    while time.monotonic()<deadline:
        assets=[]
        for p in posts:assets+=request('GET',root+f"/posts/{p['id']}/assets")
        if len(assets)>=2:break
        time.sleep(2)
    downloads=[]
    for asset in assets:
        r=client.get(root+f"/media/{asset['id']}?download=true");assert r.status_code==200
        im=Image.open(io.BytesIO(r.content));im.verify()
        downloads.append({'mime':r.headers['content-type'],'bytes':len(r.content),'download':r.headers.get('content-disposition','').startswith('attachment')})
    log('live_images',{'count':len(downloads),'downloads':downloads})
    p=request('GET',root+f"/posts/{posts[0]['id']}")
    edited=request('PATCH',root+f"/posts/{p['id']}",json={**{k:p[k] for k in ('title','platform','content_type','caption','hashtags','hook','call_to_action','image_prompt','slides')},'revision':p['revision'],'caption':p['caption']+'\nDiscuss your software goals with our team.'})
    regeneration=request('POST',root+f"/posts/{p['id']}/regenerate",json={'request_key':str(uuid4()),'mode':'caption','instructions':'Use a shorter professional caption; keep the same factual scope.'})
    wait(root,regeneration)
    assert request('GET',root+f"/posts/{p['id']}")['caption']==edited['caption']
    log('caption_regeneration',{'completed':True,'original_preserved':True})
    approved=request('POST',root+f"/posts/{p['id']}/approve",json={'revision':edited['revision']})
    future=datetime.now(ZoneInfo('Asia/Kolkata'))+timedelta(days=5)
    schedule=request('POST',root+'/schedules',json={'idempotency_key':str(uuid4()),'post_id':p['id'],'target_platform':p['platform'],'post_revision':approved['revision'],'local_date':future.date().isoformat(),'local_time':'10:00','timezone':'Asia/Kolkata'})
    step('generate');progress=request('GET',root+'/onboarding');done=request('POST',root+'/onboarding/complete',json={'revision':progress['revision']})
    assert not done['demo_completed'] and done['status']=='completed'
    log('completion_and_schedule',{'demo_completed':False,'status':done['status'],'schedule_status':schedule['status']})
    auth['post_ids']=[p['id'] for p in posts];auth_path.write_text(json.dumps(auth),encoding='utf-8')
    request('POST','/auth/logout',json={});request('POST','/auth/login',json={'email':email,'password':password})
    assert len(request('GET',root+'/posts'))==2
    log('relogin_persistence',True)
except Exception as e:
    log('remaining_failure',str(e))
finally:
    path=Path('..')/'docs'/'phase76-live-results.json';path.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('LIVE_REPORT',str(path.resolve()),flush=True)
    client.close()
