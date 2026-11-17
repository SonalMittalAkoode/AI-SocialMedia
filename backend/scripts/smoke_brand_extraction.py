"""Explicit live smoke test; creates retained smoke account/company, never prints secrets.
Run from backend/: python scripts/smoke_brand_extraction.py https://www.python.org
Start python -m app.workers.extraction separately first.
"""
import sys
import time
import secrets
from uuid import uuid4
import httpx


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.python.org"
    password = "Smoke123!" + secrets.token_urlsafe(24)
    email = f"extraction-smoke-{uuid4().hex}@example.com"
    with httpx.Client(base_url="http://localhost:8000/api/v1", headers={"Origin":"http://localhost:3000"}, timeout=20) as client:
        def call(method, path, data=None):
            response = client.request(method, path, json=data)
            if response.is_error:
                print({"step":path.split("/")[-1], "http_status":response.status_code})
                raise SystemExit(1)
            return response.json()
        call("POST", "/auth/register", {"full_name":"Extraction Smoke", "email":email,"password":password})
        call("POST", "/auth/login", {"email":email,"password":password})
        workspace=call("POST", "/workspaces", {"name":"Live extraction smoke"})
        company=call("POST", f"/workspaces/{workspace['id']}/companies", {"name":"Public website smoke", "website_url":url})
        path=f"/companies/{company['id']}"
        before=call("GET", path+"/brand")
        job=call("POST",path+"/brand-extractions",{"url":url})
        print({"job_id":job["id"],"company_id":company["id"]},flush=True)
        for _ in range(100):
            job=call("GET",path+f"/brand-extractions/{job['id']}")
            if job["status"] in {"completed","failed","cancelled"}:
                break
            time.sleep(2)
        print({"status":job["status"],"stage":job["stage"],"error_code":job["error_code"]},flush=True)
        if job["status"]!="completed":
            raise SystemExit(1)
        result=call("GET",path+f"/brand-extractions/{job['id']}/result")
        after=call("GET",path+"/brand")
        assert after==before, "Unreviewed findings changed the saved brand"
        name=result["extracted_data"]["company_name"]
        print({"source_pages":len(result["source_pages"]),"evidence_count":len(result["source_evidence"]),"model":result["model_identifier"],"brand_unchanged":True,"has_company_name":bool(name)},flush=True)
        if name:
            call("POST",path+f"/brand-extractions/{job['id']}/apply",{"company_revision":company["revision"],"brand_revision":before["revision"],"fields":{"company_name":name}})
            approved=call("GET",path+"/brand")
            assert approved["display_name"]==name and not approved["is_confirmed"]
            print({"selected_name_applied":True,"requires_confirmation":True},flush=True)


if __name__ == "__main__":
    main()
