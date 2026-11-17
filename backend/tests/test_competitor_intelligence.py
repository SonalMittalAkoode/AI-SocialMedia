import asyncio
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock
import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from app.core.intelligence_config import ai_settings as limits
from app.core.security import create_access_token
from app.models.intelligence import AIJob,Competitor,CompetitorResearch
from app.models.user import User
from app.schemas.brand_extraction import BrandAnalysis,Evidence
from app.services.search_provider import queries_for,normalize_candidates,BraveSearchProvider
from app.services.competitor_intelligence import relevance
from app.services import ai_queue
from app.services.extraction_errors import ExtractionError
from app.workers.intelligence import run_job
from test_onboarding import owner,workspace,company


def test_query_privacy_and_deduplication():
    from app.services.competitor_intelligence import own_domain
    assert own_domain('https://brewbean.example') is None
    assert own_domain('https://www.business.org')=='business.org'
    queries=queries_for({"industry":"Engineering","products_services":["Software"],"country":"India","description":"private-secret","company_name":"Private"})
    assert len(queries)<=limits.max_queries and all("private" not in q.lower() for q in queries)
    result=normalize_candidates([{"title":"One","url":"https://www.business.org","description":"First"},{"title":"Other name","url":"https://business.org/about"},{"title":"Bad","url":"http://127.0.0.1"},{"title":"Social","url":"https://linkedin.com/company/test"}])
    assert len(result)==1 and result[0].normalized_domain=="business.org"


def test_scoring_transparent_unknowns_and_weights():
    context={"industry":"Software","products_services":["Engineering"],"target_audience":"Teams","city":"Delhi","description":"Useful systems"}
    assert relevance(context,context)[0]==100
    score,reason=relevance(context,{})
    assert score==0 and "not available" in reason and "not a probability" in reason


def test_common_name_word_is_not_sufficient_identity():
    from app.services.competitor_intelligence import research
    analysis=BrandAnalysis(company_name='Other Engineering',field_evidence=[Evidence(field='company_name',value='Other Engineering',source_url='https://business.org',supporting_text='Other Engineering',classification='explicit',confidence='high')])
    result,_=asyncio.run(research({'name':'Example Engineering','website_url':'https://business.org'}, {}, SimpleNamespace(analyze=AsyncMock(return_value=(analysis,{}))),extractor=AsyncMock(return_value={'pages':[]})))
    assert result['verification_status']=='partially_verified'


def test_provider_missing_and_errors(monkeypatch):
    monkeypatch.setattr(limits,"search_provider","brave")
    monkeypatch.setattr(limits,"brave_search_api_key",None)
    with pytest.raises(ExtractionError) as error:asyncio.run(BraveSearchProvider().search_companies(["query"]))
    assert error.value.code=="search_provider_not_configured"
    monkeypatch.setattr(limits,"brave_search_api_key",SecretStr("fake-test-only"))
    async def run(status):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(status,json={}))) as client:
            with pytest.raises(ExtractionError) as error:await BraveSearchProvider(client).search_companies(["query"])
            return error.value.code
    assert asyncio.run(run(429))=="search_rate_limited"
    assert asyncio.run(run(503))=="search_unavailable"


@pytest.fixture
def setup(client,owner):
    c=company(client,workspace(client)["id"])
    root=f"/api/v1/companies/{c['id']}"
    client.post(root+"/brand/confirm",json={"revision":1})
    return c,root


def add(client,root):
    response=client.post(root+"/competitors",json={"name":"Example Engineering","website_url":"https://business.org"})
    assert response.status_code==201,response.text
    return response.json()


def test_manual_persistence_approval_rejection_revision(client,setup):
    c,root=setup
    record=add(client,root)
    assert add(client,root)["id"]==record["id"]
    assert record["verification_status"]=="unverified"
    url=root+f"/competitors/{record['id']}"
    approved=client.patch(url,json={"revision":1,"selection_status":"approved"})
    assert approved.status_code==200
    assert client.get(root+"/competitors").json()[0]["selection_status"]=="approved"
    assert client.patch(url,json={"revision":1,"selection_status":"rejected"}).status_code==409
    assert client.patch(url,json={"revision":approved.json()["revision"],"selection_status":"rejected"}).status_code==200
    assert client.post(root+"/competitors",json={"name":"Bad URL","website_url":"http://localhost"}).status_code==422


def test_provider_unavailable_and_unconfirmed_brand(client,setup,monkeypatch):
    _,root=setup
    monkeypatch.setattr(limits,"brave_search_api_key",None)
    assert client.post(root+"/competitor-discoveries",json={"request_key":str(uuid4())}).status_code==503
    b=client.get(root+"/brand").json()
    client.patch(root+"/brand",json={"revision":b["revision"],"tagline":"Changed"})
    record=add(client,root)
    assert client.post(root+f"/competitors/{record['id']}/research",json={"request_key":str(uuid4())}).status_code==422


def test_tenant_and_role_boundaries(client,db,owner,setup):
    _,root=setup
    record=add(client,root)
    other=User(full_name="Other",email=f"other-{uuid4().hex}@example.com",hashed_password=owner.hashed_password)
    db.add(other);db.commit();client.cookies.set("access_token",create_access_token(other.id))
    for path in ["/competitors","/competitor-insights",f"/competitors/{record['id']}","/ai-jobs"]:assert client.get(root+path).status_code==404
    assert client.post(root+"/competitors",json={"name":"Intruder","website_url":"https://business.org"}).status_code==404
    assert client.patch(root+f"/competitors/{record['id']}",json={"revision":1,"selection_status":"approved"}).status_code==404


def test_research_job_execution_evidence_and_idempotency(client,db,setup):
    c,root=setup;record=add(client,root);key=str(uuid4())
    url=root+f"/competitors/{record['id']}/research"
    response=client.post(url,json={"request_key":key});assert response.status_code==202
    job=response.json()
    assert client.post(url,json={"request_key":key}).json()["id"]==job["id"]
    claimed=ai_queue.claim(db,company_id=c["id"])
    @contextmanager
    def factory():yield db
    analysis=BrandAnalysis(company_name="Example Engineering",description="Provides software engineering for teams.",field_evidence=[Evidence(field="company_name",value="Example Engineering",source_url="https://business.org",supporting_text="Example Engineering",classification="explicit",confidence="high")])
    analyzer=SimpleNamespace(analyze=AsyncMock(return_value=(analysis,{})))
    extract=AsyncMock(return_value={"pages":[],"warnings":[]})
    asyncio.run(run_job(claimed,analyzer,session_factory=factory,extractor=extract))
    assert client.get(root+f"/ai-jobs/{job['id']}").json()["status"]=="completed"
    assert client.get(root+"/competitors").json()[0]["verification_status"]=="verified"
    insights=client.get(root+"/competitor-insights").json()
    assert len(insights)==1 and insights[0]["source_evidence"][0]["source_url"]=="https://business.org"
    asyncio.run(run_job(claimed,analyzer,session_factory=factory,extractor=extract))
    assert len(client.get(root+"/competitor-insights").json())==1


def test_stale_worker_and_retry_budget(client,db,setup):
    c,root=setup;record=add(client,root)
    job=client.post(root+f"/competitors/{record['id']}/research",json={"request_key":str(uuid4())}).json()
    claimed=ai_queue.claim(db,company_id=c["id"])
    ai_queue.fail(db,*claimed,ExtractionError("network","Safe retry",True))
    assert db.get(AIJob,job["id"]).status=="queued"
    row=db.get(AIJob,job["id"]);row.available_at=__import__('app.services.extraction_jobs',fromlist=['now']).now()-timedelta(seconds=1);db.commit()
    latest=ai_queue.claim(db,company_id=c["id"])
    assert ai_queue.leased(db,*claimed) is None
    ai_queue.fail(db,*latest,ExtractionError("restricted","Safe failure"))
    assert db.get(AIJob,job["id"]).status=="failed"
