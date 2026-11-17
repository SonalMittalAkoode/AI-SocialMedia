"""Explicit final live QA continuation; only uses the isolated Phase 7.6 account."""
import argparse,io,json,tempfile,time
from pathlib import Path
from uuid import uuid4
import httpx
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('--live',action='store_true',required=True);p.parse_args()
auth=json.loads((Path(tempfile.gettempdir())/'socialai-phase76-live-auth.json').read_text(encoding='utf-8'))
assert auth['email'].startswith('e2e-phase76-live-')
report_path=Path('../docs/phase76-live-results.json');report=json.loads(report_path.read_text(encoding='utf-8'))
client=httpx.Client(base_url='http://localhost:8000/api/v1',headers={'Origin':'http://localhost:3000'},timeout=100)
def req(method,path,**kwargs):
 r=client.request(method,path,**kwargs)
 if r.status_code>=400:raise RuntimeError(f'{path}: HTTP {r.status_code} {r.text[:300]}')
 return r.json()
def log(key,value):report['checks'][key]=value;report_path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({key:value}),flush=True)
def wait(root,job,extraction=False,seconds=220):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  row=req('GET',root+('/brand-extractions/' if extraction else '/ai-jobs/')+job['id'])
  if row['status']=='completed':return row
  if row['status'] in ('failed','cancelled'):raise RuntimeError(row.get('error_code','')+': '+row.get('error_message',''))
  time.sleep(2)
 raise RuntimeError('Live wait deadline reached')
try:
 req('POST','/auth/login',json={'email':auth['email'],'password':auth['password']})
 root=f"/companies/{auth['company_id']}"
 extraction=req('GET',root+f"/brand-extractions/{auth['extraction_job_id']}/result")
 fields={k:v for k,v in extraction['extracted_data'].items() if k not in ('warnings','field_evidence','overall_confidence') and v not in (None,[],{},'')}
 log('akoode_website',{'canonical':extraction['source_pages'][0]['url'],'source_pages':len(extraction['source_pages']),'populated_fields':list(fields),'industry':fields.get('industry'),'services':len(fields.get('products_services',[]))})
 logo=client.get(root+'/brand/logo');log('actual_logo',{'stored':logo.status_code==200,'mime':logo.headers.get('content-type'),'bytes':len(logo.content)})
 posts=req('GET',root+'/posts');second=next(v for v in posts if v['platform']=='LinkedIn')
 job=req('POST',root+f"/posts/{second['id']}/images",json={'request_key':str(uuid4()),'aspect_ratio':'1:1','instructions':'Make the composition more minimal, with original abstract blue and white geometric forms.'})
 wait(root,job,seconds=260)
 assets=req('GET',root+f"/posts/{second['id']}/assets")
 log('independent_image_regeneration',{'status':'completed','retained_images':len(assets)})
 image=client.get(root+f"/media/{assets[0]['id']}?download=true");Image.open(io.BytesIO(image.content)).verify()
 current=req('GET',root+f"/posts/{second['id']}")
 upload=req('POST',root+f"/posts/{second['id']}/assets/upload",params={'revision':current['revision'],'filename':'phase76-upload-check.png'},content=image.content,headers={'Content-Type':'image/png'})
 log('custom_image_upload',{'stored':True,'source':upload.get('source'),'downloaded_real_image_reuploaded_for_qa':True})
 other=req('POST',f"/workspaces/{auth['workspace_id']}/companies",json={'name':'Project Gutenberg live verification','website_url':'https://www.gutenberg.org'})
 other_root=f"/companies/{other['id']}";auth['other_company_id']=other['id']
 (Path(tempfile.gettempdir())/'socialai-phase76-live-auth.json').write_text(json.dumps(auth),encoding='utf-8')
 job=req('POST',other_root+'/brand-extractions',json={'url':'https://www.gutenberg.org'})
 wait(other_root,job,extraction=True)
 result=req('GET',other_root+f"/brand-extractions/{job['id']}/result")
 data=result['extracted_data'];fields={k:v for k,v in data.items() if k not in ('warnings','field_evidence','overall_confidence') and v not in (None,[],{},'')}
 c=req('GET',other_root);b=req('GET',other_root+'/brand')
 req('POST',other_root+f"/brand-extractions/{job['id']}/apply",json={'company_revision':c['revision'],'brand_revision':b['revision'],'fields':fields})
 log('different_industry',{'website':'https://www.gutenberg.org','name':data['company_name'],'industry':data['industry'],'fields_applied':list(fields),'source_pages':len(result['source_pages'])})
except Exception as exc:log('extras_remaining_limitation',str(exc))
finally:client.close()
