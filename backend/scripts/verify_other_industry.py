"""One explicit live extraction checkpoint, using only the isolated QA account."""
import argparse,json,tempfile,time
from pathlib import Path
import httpx
p=argparse.ArgumentParser();p.add_argument('--live',action='store_true',required=True);p.parse_args()
file=Path(tempfile.gettempdir())/'socialai-phase76-live-auth.json'
a=json.loads(file.read_text(encoding='utf-8'));assert a['email'].startswith('e2e-phase76-live-')
report_path=Path('../docs/phase76-live-results.json');report=json.loads(report_path.read_text(encoding='utf-8'))
with httpx.Client(base_url='http://localhost:8000/api/v1',headers={'Origin':'http://localhost:3000'},timeout=100) as c:
 def req(method,url,**kw):
  r=c.request(method,url,**kw);r.raise_for_status();return r.json()
 req('POST','/auth/login',json={'email':a['email'],'password':a['password']})
 company=req('POST',f"/workspaces/{a['workspace_id']}/companies",json={'name':'NASA public education QA','website_url':'https://www.nasa.gov'})
 root=f"/companies/{company['id']}";a['other_company_id']=company['id'];file.write_text(json.dumps(a),encoding='utf-8')
 job=req('POST',root+'/brand-extractions',json={'url':'https://www.nasa.gov'})
 end=time.monotonic()+230
 while time.monotonic()<end:
  row=req('GET',root+'/brand-extractions/'+job['id'])
  if row['status'] in ('completed','failed','cancelled'):break
  time.sleep(2)
 if row['status']=='completed':
  result=req('GET',root+'/brand-extractions/'+job['id']+'/result');data=result['extracted_data']
  fields={k:v for k,v in data.items() if k not in ('warnings','field_evidence','overall_confidence') and v not in (None,[],{},'')}
  company=req('GET',root);brand=req('GET',root+'/brand')
  applied=req('POST',root+'/brand-extractions/'+job['id']+'/apply',json={'company_revision':company['revision'],'brand_revision':brand['revision'],'fields':fields})
  check={'website':'https://www.nasa.gov','name':data.get('company_name'),'industry':data.get('industry'),'fields_applied':list(fields),'source_pages':len(result['source_pages'])}
 else:check={'website':'https://www.nasa.gov','status':row['status'],'error_code':row.get('error_code'),'error_message':row.get('error_message')}
 report['checks']['different_industry']=check;report_path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(check))
