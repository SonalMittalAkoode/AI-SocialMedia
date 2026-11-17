# Company onboarding foundation

Phase 3 extends the existing FastAPI, SQLAlchemy, Alembic, PostgreSQL, and Next.js application. Authentication and the existing visual design are retained. Company, brand, preferences, membership, and onboarding state now come from the server. No website or social URL is fetched.

## Database architecture

Migration `6dc2c3a509f5` follows `148ca6c35a66`. Its upgrade creates six tables and their indexes/constraints; it does not alter or delete users. It was reviewed and applied to the existing database. No database or volume was reset. The original 13 users were present when the migration was applied. Browser tests create additional real test accounts and companies; these records are retained.

| Table | Relationships and constraints |
| --- | --- |
| `workspaces` | UUID primary key; creator references users with RESTRICT; unique indexed slug; unique creator/creation-key; name validation; revision and timestamps |
| `workspace_members` | UUID primary key; workspace CASCADE and user RESTRICT foreign keys; indexed foreign keys; unique workspace/user; owner/admin/member role check; joined timestamp |
| `companies` | UUID primary key; indexed workspace FK with RESTRICT; unique workspace/creation-key; draft/active/archived check; revision and timestamps |
| `brand_profiles` | Unique company FK with CASCADE; bounded API collections stored as JSONB; JSON type checks; source check; confirmation flag/timestamp consistency; revision and timestamps |
| `content_preferences` | Unique company FK with CASCADE; JSONB collections with type checks; language and custom weekly count checks; revision and timestamps |
| `onboarding_progress` | Unique company FK with CASCADE; step/status checks; completed/demo arrays; completion timestamp and demo consistency; revision, started/updated/completed timestamps |

Workspace creation inserts the owner membership in the same transaction. Company creation inserts its brand, preferences, and progress in the same transaction. Slugs use a normalized name plus a random suffix, with bounded collision retries. Optional UUID creation keys make retries idempotent. There are no deletion endpoints. Do not downgrade a populated deployment: the generated downgrade drops the six new tables.

## API contract

All routes use `/api/v1`, the existing `access_token` cookie, and the existing current-user dependency. Writes reuse the existing Origin validation. Responses use typed schemas and `Cache-Control: no-store`.

| Method | Route | Behavior |
| --- | --- | --- |
| POST / GET | `/workspaces` | Atomic creation / list current user's memberships |
| GET / PATCH | `/workspaces/{id}` | Read / update name and description |
| GET | `/workspaces/{id}/membership` | Current user's membership and role |
| POST / GET | `/workspaces/{id}/companies` | Atomic initialization / paginated listing (`offset`, `limit`, maximum 100) |
| GET / PATCH | `/companies/{id}` | Read / partial business update |
| GET / PATCH | `/companies/{id}/brand` | Read / partial brand edit |
| POST | `/companies/{id}/brand/confirm` | Validate and explicitly confirm brand |
| GET / PUT | `/companies/{id}/preferences` | Read / update supplied preference fields |
| GET / PATCH | `/companies/{id}/onboarding` | Read / navigate unlocked steps |
| POST | `/companies/{id}/onboarding/complete-step` | Validate a sequential step |
| POST | `/companies/{id}/onboarding/complete` | Revalidate and finish the acknowledged demo workflow |

Members can read; owners/admins can write. Every resource lookup checks membership; other tenants receive 404. There is no invitation, membership management, or role escalation API. User/workspace ownership fields cannot be supplied through update schemas.

Every update/confirmation/transition requires the returned positive `revision`. Stale updates return 409 and never silently retry. Company updates optionally accept `expected_brand_revision`; the frontend supplies it when saving business/brand forms to detect related stale data. Writes lock the authorized company and use SQLAlchemy version checks. Creation accepts `idempotency_key`; reuse the same key and payload when retrying creation. Changed payloads against an existing key return a conflict. IDs and timestamps are server-owned.

Validation rejects unknown fields, unsupported canonical choices, duplicate collection values, oversized text/arrays, malformed colors, credentials in URLs, and unsupported social hosts. HTTP(S) URLs are normalized without fetching; fragments are removed. Brand sources accepted by public writes are `manual` and `imported`. The database reserves `ai` for future trusted extraction. The current frontend writes `manual`, including reviewed mock suggestions.

Preferences use canonical lowercase platform, goal, tone, format, frequency, and language values. The frontend maps its existing labels to these values. A custom frequency requires 1–21 posts per week. Confirming a brand requires a name and a description of at least 10 characters. Material business or brand edits remove confirmation and invalidate the affected later steps. Preference changes invalidate preferences and later completion. Confirmation and completed-step flags cannot be forged by ordinary PATCH requests.

Step order is business → brand → competitors → preferences → generate. Competitors and generate explicitly require `demo_acknowledged: true`; progress stores `demo_steps` and `demo_completed`. Completion means the demo onboarding workflow finished, not that real competitors were researched or AI content produced.

Errors: 401 invalid session, 403 read-only member or rejected Origin, 404 inaccessible/missing resource, 409 conflict, 422 validation, 503 unavailable storage. Database exception details are not returned. Frontend requests time out and retain the editable draft; no automatic mutation retry occurs.

## Frontend persistence and recovery

The existing provider still owns session/UI state. Its persistence hook loads authorized workspaces and companies only after `/auth/me` verifies the user. A stored selection is accepted only if returned by the server; otherwise the first available authorized company is selected. No mount effect creates database records. Continue, Confirm, Save & Exit, brand Save, and workspace-name Save trigger real API actions. Creation keys are retained across retries and refreshes. Progress and current route restore from the server after refresh/login.

The existing workspace dialog now selects companies/workspaces and starts new setups. Onboarding exposes the same switch control. Server data is authoritative. Company-scoped caches (`socialai-company-draft:<user>:<company>`) retain mock posts, competitors, local logo previews, and unsaved forms. Pending new-company drafts use a user and creation-key scoped cache. Selection uses `socialai-active:<user>`; none of these establish authentication.

Differing local forms are backed up before server hydration. Legacy `socialai-demo-v1` and per-user v1 caches are preserved and offered through **Review local draft**. They never silently create or overwrite records. **Restore draft for review** fills the selected company's form; the user must save/confirm and the server validates progress again. Review the selected company before importing an old draft. Browser storage is not suitable for sensitive content.

A 409 leaves the form intact and offers **Reload server data · keep browser draft**. Reload then explicitly recover/review and merge the needed edits; there is no automatic overwrite. Local mock posts/competitors and notification/profile previews remain browser-only. Reset clears the active company's mock posts/competitors. It does not clear persisted company records.

## Run and verify

Use existing environment files; this phase adds no secrets or required environment variables. Start PostgreSQL using the existing Docker Compose setup, then from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

From `frontend/`, run `npm run dev`. Use localhost consistently with the existing cookie/CORS configuration. Sign up, log in, enter a real business name and details, review the mock suggestions, explicitly confirm brand, choose preferences, and complete the clearly identified demo steps. Refresh/log out and back in to resume. Add a second company via the workspace dialog to verify isolation of the selected company's data.

Validation commands:

```powershell
# backend/
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m alembic check
# frontend/
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test
```

Backend tests use rollback transactions against the configured PostgreSQL database; row assertions are scoped to their fixtures so preexisting records remain valid. Browser tests require the running API/database and create retained accounts/companies. Coverage includes auth regression, atomic creation and rollback, uniqueness/FKs, roles, every company resource's tenant boundaries, typed validation, optimistic conflicts, confirmation invalidation, sequential/demo completion, refresh, explicit recovery, and company selection at mobile/desktop sizes.

Final verification on 2026-11-14:

| Check | Result |
| --- | --- |
| `python -m pytest -q` | 50 passed, including the existing authentication regression tests |
| `alembic check` | Passed; no new upgrade operations detected |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed after correcting an unescaped apostrophe in reset copy |
| `npm test` | 33 passed across 3 files |
| `npm run build` | Passed; optimized Next.js build and TypeScript compilation |
| `npx playwright test` | All 12 passed in 3.3 minutes; existing full journey, auth regressions, draft/conflict/tenant checks, and responsive screens at 375/768/1024/1440px |
| Database inspection | Head `6dc2c3a509f5`; 26 users, 13 workspaces/memberships, 15 companies with 15 brand/preferences/progress records; zero incomplete initializations |

The first expanded backend run exposed four tests that assumed globally empty company tables after live browser tests had created records. Assertions now scope to the fixture's owner/workspace/company; no records were deleted to make tests pass. Tooling emits a Starlette/httpx deprecation warning, a Vite config-loader compatibility warning, and a Playwright color-environment warning. They do not fail these checks. No unresolved test failures remain.

## Phase 3 file inventory

Created:

- `backend/alembic/versions/6dc2c3a509f5_add_workspace_and_company_onboarding_.py`
- `backend/app/models/onboarding.py`
- `backend/app/schemas/onboarding.py`
- `backend/app/core/permissions.py`
- `backend/app/services/__init__.py`
- `backend/app/services/onboarding.py`
- `backend/app/api/onboarding.py`
- `backend/tests/test_onboarding.py`
- `frontend/src/lib/company-api.ts`
- `frontend/src/lib/company-state.ts`
- `frontend/src/store/use-company-persistence.ts`
- `frontend/src/components/company-controls.tsx`
- `frontend/tests/unit/company-state.test.ts`
- `frontend/tests/e2e/company.spec.ts`
- `docs/company-onboarding.md`

Modified:

- `backend/alembic/env.py` — register model metadata.
- `backend/app/main.py` — register company routes.
- `frontend/src/lib/auth-api.ts` — export the shared API base URL.
- `frontend/src/types/index.ts` and `frontend/src/lib/storage.ts` — current server step and route restoration.
- `frontend/src/store/provider.tsx` — bootstrap real company persistence after verified authentication; retain local mock data.
- `frontend/src/components/onboarding.tsx` — real saves, validation, navigation, completion, recovery, switching.
- `frontend/src/components/brand-form.tsx` — real brand save and conflict/recovery UI.
- `frontend/src/components/content/studio.tsx` — preserve saved mock drafts during finish/resume.
- `frontend/src/components/dashboard/shell.tsx` — workspace/company selection dialog.
- `frontend/src/components/dashboard/sections.tsx` — real workspace rename and accurate reset copy.
- `frontend/tests/e2e/auth-helpers.ts` — initialize a real server workspace for authenticated browser tests.
- `frontend/tests/e2e/auth.spec.ts` — company-scoped cache assertion.
- `frontend/tests/e2e/journey.spec.ts` — required business fields in the existing journey.
- `README.md` — current persistence behavior and documentation link.

Prior authentication-phase edits remain in the working tree. They are documented separately in `docs/authentication.md`, which this phase does not overwrite. Existing tracked Python bytecode can change when tests/imports run; it is not application source.

## Limitations and next phase

Real extraction, scraping, AI jobs, competitor records, posts, publishing, OAuth, billing, invitations, and production analytics are deliberately deferred. Logo uploads are browser previews; there is no object storage. Some backend fields have no editor in the current UI. Saving the business form and brand form involves separate requests; successful stages are retained and retries surface revision conflicts rather than promising an all-screen atomic transaction. Server revalidation and selection happen client-side after verified authentication; production SSR session handling can be added separately.

The next phase should implement queued extraction with explicit provenance/review, SSRF-safe URL fetching (including redirect/DNS/private-network controls), bounded content and time limits, retries, observability, and tests before enabling network fetching. Existing authentication production limitations remain in the authentication handoff. This phase does not change JWT revocation, email verification, or rate limiting.
