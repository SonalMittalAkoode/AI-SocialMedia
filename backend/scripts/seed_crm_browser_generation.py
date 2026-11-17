"""Create one retained, clearly labeled completed job fixture; never call a provider.

Only accepts the isolated e2e-* test accounts created by the browser test helper.
Usage from backend/: python scripts/seed_crm_browser_generation.py COMPANY USER
"""
import json
import sys
from datetime import datetime, timezone
from uuid import UUID, uuid4
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app  # noqa: F401; register existing models
from app.db.database import SessionLocal
from app.models.user import User
from app.models.intelligence import AIJob
from app.core.permissions import company_access


def main():
    company_id, user_id = map(UUID, sys.argv[1:3])
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if not user or not (user.email.startswith('e2e-') and user.email.endswith('@example.com')):
            raise SystemExit('Only isolated browser-test accounts can use this fixture')
        company = company_access(db, user, company_id, True)
        draft = {'title': 'CRM browser recovery fixture', 'platform': 'LinkedIn', 'content_type': 'text',
            'caption': 'A retained browser test result. No AI provider was called.', 'hashtags': [],
            'hook': '', 'call_to_action': '', 'image_prompt': '', 'slides': []}
        job = AIJob(company_id=company_id, requested_by=user.id, kind='content_generation', request_key=uuid4(),
            status='completed', stage='completed', model_identifier='browser-test-fixture-no-provider',
            completed_at=datetime.now(timezone.utc),
            payload={'request': {'topic': draft['title']}, 'context': {'brand_revision': company.brand.revision}},
            result={'posts': [draft], 'strategy': {}, 'warnings': ['Test fixture; no provider call']})
        db.add(job); db.commit()
        print(json.dumps({'job_id': str(job.id), 'title': draft['title']}))


if __name__ == '__main__':
    main()
