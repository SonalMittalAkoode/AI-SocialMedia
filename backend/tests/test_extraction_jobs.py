import asyncio
from datetime import timedelta
from uuid import uuid4
from unittest.mock import AsyncMock
from contextlib import contextmanager
import pytest
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError, OperationalError
from app.models.brand_extraction import BrandExtractionJob as Job, BrandExtractionResult as Result
from app.models.onboarding import Company, WorkspaceMember
from app.models.user import User
from app.core.security import create_access_token
from app.core.extraction_config import extraction_settings as limits
from app.schemas.brand_extraction import BrandAnalysis
from app.services import extraction_jobs as jobs
from app.services.extraction_errors import ExtractionError
from app.workers.extraction import run_job
from test_onboarding import owner, company, workspace


@pytest.fixture
def setup(client,owner,monkeypatch):
    c=company(client,workspace(client)["id"])
    root=f"/api/v1/companies/{c['id']}/brand-extractions"
    original_claim=jobs.claim
    monkeypatch.setattr(jobs,"claim",lambda session:original_claim(session,company_id=c["id"]))
    return c,root


def start(client,root,**values):
    response=client.post(root,json={"url":"https://business.org",**values})
    assert response.status_code==202,response.text
    return response.json()


def completed(db,client,root):
    job=start(client,root)
    record=db.get(Job,job["id"])
    record.status,record.stage="completed","completed"
    record.completed_at=jobs.now()
    db.add(Result(job_id=record.id,company_id=record.company_id,extracted_data=BrandAnalysis(company_name="Suggested name",description="A reviewed description of a real business.",value_proposition="Useful products").model_dump(),source_evidence=[],source_pages=[],warnings=[],model_identifier="test-model"))
    db.commit()
    return job


def test_creation_dedupe_recent_reuse_and_history(client,db,setup):
    c,root=setup
    job=start(client,root)
    assert start(client,root)["id"]==job["id"]
    assert client.post(root,json={"url":"https://different.org"}).status_code==409
    assert client.get(root).json()[0]["id"]==job["id"]
    assert client.get(root+f"/{job['id']}/result").status_code==409
    assert client.post(root+f"/{job['id']}/apply",json={"company_revision":1,"brand_revision":1,"fields":{"company_name":"bad"}}).status_code==409
    record=db.get(Job,job["id"]);record.status=record.stage="completed";db.commit()
    assert start(client,root)["id"]==job["id"]
    assert start(client,root,reanalyze=True)["id"]!=job["id"]


def test_job_claim_lease_recovery_and_result_idempotency(client,db,setup):
    _,root=setup
    job=start(client,root)
    claimed=jobs.claim(db)
    assert str(claimed[0])==job["id"]
    jobs.stage(db,*claimed[:2],"analyzing")
    assert client.get(root+f"/{job['id']}").json()["stage"]=="analyzing"
    analysis=BrandAnalysis()
    website={"pages":[{"url":"https://business.org","title":"Business"}],"warnings":[]}
    assert jobs.succeed(db,*claimed[:2],analysis,website,{},"model",123)
    assert not jobs.succeed(db,*claimed[:2],analysis,website,{},"model",123)
    assert db.scalar(select(func.count()).select_from(Result).where(Result.job_id==claimed[0]))==1
    assert client.get(root+f"/{job['id']}/result").status_code==200
    newer=start(client,root,reanalyze=True)
    token=jobs.claim(db)
    record=db.get(Job,newer["id"]);record.lease_expires_at=jobs.now()-timedelta(seconds=1);db.commit()
    assert jobs.claim(db) is None
    assert not jobs.succeed(db,*token[:2],analysis,website,{},"model",1)
    record=db.get(Job,newer["id"]);record.available_at=jobs.now()-timedelta(seconds=1);db.commit()
    claimed=jobs.claim(db)
    jobs.fail(db,*claimed[:2],ExtractionError("permanent","Safe failure"))
    assert client.get(root+f"/{newer['id']}").json()["status"]=="failed"
    assert client.get(root+f"/{newer['id']}/result").status_code==422


def test_retry_backoff_bounded_attempts(client,db,setup):
    _,root=setup
    record=start(client,root)
    for attempt in range(limits.max_attempts):
        job=db.get(Job,record["id"]);job.available_at=jobs.now()-timedelta(seconds=1);db.commit()
        claimed=jobs.claim(db)
        jobs.fail(db,*claimed[:2],ExtractionError("network","Safe retry",True))
    assert client.get(root+f"/{record['id']}").json()["status"]=="failed"
    assert db.get(Job,record["id"]).attempt_count==limits.max_attempts


def test_apply_only_selected_fields_conflict_and_confirmation(client,db,setup):
    c,root=setup
    brand_url=f"/api/v1/companies/{c['id']}/brand"
    assert client.post(brand_url+"/confirm",json={"revision":1}).status_code==200
    job=completed(db,client,root)
    before=client.get(brand_url).json()
    assert before["is_confirmed"] is True and before["display_name"]=="My Cafe"
    url=root+f"/{job['id']}/apply"
    body={"company_revision":1,"brand_revision":before["revision"],"fields":{"company_name":"Approved edited name","value_proposition":"Edited recommendation"}}
    assert client.post(url,json={**body,"brand_revision":1}).status_code==409
    assert client.post(url,json=body).status_code==200
    after=client.get(brand_url).json()
    assert after["display_name"]=="Approved edited name" and after["description"]==before["description"]
    assert after["is_confirmed"] is False and after["source"]=="ai"
    assert "Edited recommendation" in after["content_guidelines"]
    assert client.post(url,json=body).status_code==409
    body={"company_revision":2,"brand_revision":after["revision"],"fields":{"social_links":{"instagram":"https://attacker.org"}}}
    assert client.post(url,json=body).status_code==422


def test_tenant_and_role_boundaries(client,db,owner,setup):
    c,root=setup
    job=completed(db,client,root)
    member=db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id==c["workspace_id"]))
    member.role="member";db.commit()
    assert client.get(root).status_code==200
    assert client.post(root,json={"url":"https://business.org"}).status_code==403
    assert client.post(root+f"/{job['id']}/apply",json={"company_revision":1,"brand_revision":1,"fields":{"company_name":"Name"}}).status_code==403
    other=User(full_name="Other",email=f"other-{uuid4().hex}@example.com",hashed_password=owner.hashed_password)
    db.add(other);db.commit();client.cookies.set("access_token",create_access_token(other.id))
    for suffix in ["",f"/{job['id']}",f"/{job['id']}/result"]:
        assert client.get(root+suffix).status_code==404
    assert client.post(root,json={"url":"https://business.org"}).status_code==404
    assert client.post(root+f"/{job['id']}/apply",json={"company_revision":1,"brand_revision":1,"fields":{"company_name":"Name"}}).status_code==404


def test_atomic_creation_storage_failure_and_limits(client,db,setup,monkeypatch):
    c,root=setup
    original=db.commit
    def fail():raise OperationalError("private SQL",{},Exception("secret"))
    monkeypatch.setattr(db,"commit",fail)
    response=client.post(root,json={"url":"https://business.org"})
    assert response.status_code==503 and "private" not in response.text
    assert db.scalar(select(func.count()).select_from(Job).where(Job.company_id==c["id"]))==0
    monkeypatch.setattr(db,"commit",original)
    monkeypatch.setattr(limits,"company_hourly_limit",1)
    job=start(client,root);record=db.get(Job,job["id"]);record.status=record.stage="failed";db.commit()
    assert client.post(root,json={"url":"https://business.org"}).status_code==429


def test_job_constraints(client,db,setup):
    c,root=setup
    job=start(client,root)
    with pytest.raises(IntegrityError),db.begin_nested():
        db.add(Job(company_id=c["id"],requested_by=db.get(Job,job["id"]).requested_by,requested_url="https://business.org"));db.flush()
    with pytest.raises(IntegrityError),db.begin_nested():
        db.add(Result(job_id=job["id"],company_id=uuid4(),extracted_data={},source_evidence=[],source_pages=[],warnings=[],model_identifier="test"));db.flush()


def test_worker_orchestration_persists_stages_and_result(client,db,setup):
    _,root=setup
    record=start(client,root)
    claimed=jobs.claim(db)
    @contextmanager
    def factory():yield db
    async def extract(url,stage):
        stage("cleaning")
        return {"pages":[{"url":url,"title":"Retrieved"}],"warnings":[]}
    analyzer=type("Analyzer",(),{})()
    analyzer.analyze=AsyncMock(return_value=(BrandAnalysis(company_name="Retrieved"),{}))
    asyncio.run(run_job(claimed,analyzer,session_factory=factory,extractor=extract))
    assert client.get(root+f"/{record['id']}").json()["status"]=="completed"
    assert client.get(root+f"/{record['id']}/result").json()["extracted_data"]["company_name"]=="Retrieved"
    assert client.get(f"/api/v1/companies/{setup[0]['id']}/brand").json()["display_name"]=="My Cafe"


def test_worker_failure_and_elapsed_budget_are_persisted(client,db,setup,monkeypatch):
    _,root=setup
    record=start(client,root)
    claimed=jobs.claim(db)
    @contextmanager
    def factory():yield db
    async def extract(url,stage):raise ExtractionError("restricted","Safe failure")
    asyncio.run(run_job(claimed,None,session_factory=factory,extractor=extract))
    assert client.get(root+f"/{record['id']}").json()["error_code"]=="restricted"
    retry=start(client,root)
    claimed=jobs.claim(db)
    job=db.get(Job,retry["id"]);job.started_at=jobs.now()-timedelta(seconds=61);db.commit()
    jobs.fail(db,*claimed[:2],ExtractionError("job_timeout","Safe timeout",True))
    assert client.get(root+f"/{retry['id']}").json()["status"]=="failed"
    assert db.get(Job,retry["id"]).duration_ms>=60000
