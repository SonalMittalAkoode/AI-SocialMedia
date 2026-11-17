"""Opt-in live text test, retained smoke account/company/post. Never prints secrets.

From backend/: python scripts/smoke_content.py --run-live --max-budget-usd 0.05
Max two text requests, zero search/image calls. Uses the configured gemini-2.5-flash
at Nov 15 2026 standard rates ($0.30/M input, $2.50/M output); conservative token
bound < $0.05. No SDK automatic retries. Recheck current pricing before running.
"""
import argparse
import asyncio
import secrets
import sys
from pathlib import Path
from uuid import uuid4
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services.gemini_brand_analyzer import GeminiBrandAnalyzer
from app.services import ai_queue
from app.db.database import SessionLocal
from app.models import user,content,brand_extraction  # register related models
from app.workers.intelligence import run_job


async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-live',action='store_true');parser.add_argument('--max-budget-usd',type=float,default=0)
    args=parser.parse_args()
    if not args.run_live or args.max_budget_usd<0.05:parser.error('Explicit --run-live --max-budget-usd 0.05 required')
    if settings.GEMINI_MODEL!='gemini-2.5-flash':parser.error('Review pricing and smoke budget for the configured model first')
    ai_settings.max_attempts=1
    with httpx.Client(base_url='http://localhost:8000/api/v1',headers={'Origin':'http://localhost:3000'},timeout=20) as client:
        def call(method,path,data=None):
            response=client.request(method,path,json=data)
            if response.is_error:raise RuntimeError(f'Smoke API HTTP {response.status_code}')
            return response.json()
        password='Smoke123!'+secrets.token_urlsafe(24);email=f'content-smoke-{uuid4().hex}@example.com'
        call('POST','/auth/register',{'full_name':'Content Smoke','email':email,'password':password})
        call('POST','/auth/login',{'email':email,'password':password})
        workspace=call('POST','/workspaces',{'name':'Live content smoke'})
        company=call('POST',f"/workspaces/{workspace['id']}/companies",{'name':'Example Engineering','industry':'Software','description':'Custom software engineering for small teams.'})
        root=f"/companies/{company['id']}"
        brand=call('GET',root+'/brand')
        call('PATCH',root+'/brand',{'revision':brand['revision'],'display_name':'Example Engineering','description':'Custom software engineering for small teams.','products_services':['Software engineering'],'target_audience':'Small teams','brand_voice':['Clear']})
        brand=call('GET',root+'/brand');call('POST',root+'/brand/confirm',{'revision':brand['revision']})
        job=call('POST',root+'/content-generations',{'request_key':str(uuid4()),'platforms':['LinkedIn'],'content_type':'educational','topic':'Starting a thoughtful software project'})
        print({'job_id':job['id'],'company_id':company['id'],'max_requests':2,'max_budget_usd':0.05},flush=True)
        with SessionLocal() as db:claimed=ai_queue.claim(db,company_id=company['id'])
        if not claimed:raise RuntimeError('Job already claimed; do not rerun this smoke against another active worker')
        analyzer=GeminiBrandAnalyzer()
        try:await run_job(claimed,analyzer)
        finally:await analyzer.close()
        status=call('GET',root+'/ai-jobs/'+job['id'])
        print({'status':status['status'],'error_code':status['error_code']},flush=True)
        if status['status']!='completed':raise SystemExit(1)
        result=call('GET',root+'/content-generations/'+job['id']+'/result')
        post=call('POST',root+'/posts',{**result['posts'][0],'creation_key':str(uuid4()),'generation_job_id':job['id'],'result_index':0})
        assert call('GET',root+'/posts/'+post['id'])['caption']==post['caption']
        print({'saved_post_id':post['id'],'result_count':len(result['posts']),'draft_persisted':True},flush=True)


if __name__=='__main__':asyncio.run(main())
