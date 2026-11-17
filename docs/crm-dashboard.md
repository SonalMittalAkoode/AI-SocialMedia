# SocialAI CRM dashboard

## CRM refinements — 17 November 2026 (latest)

Builds on the Phase 7.5 CRM described below; nothing there was removed. Routes are unchanged.

### Layout and navigation

- Sidebar order and labels now match the product spec: Overview, **Companies & Brands**, AI Content Studio, Post Library, **Competitor Intelligence**, Content Calendar, **Social Accounts, Analytics**, then Settings. Page headings match.
- The collapsible sidebar now remembers its state per browser (`localStorage`, guarded for private mode).
- KPI cards are more compact: 10 cards in a 5-column grid on desktop, 3 columns below 1100 px and 2 on mobile.

### Overview (all values from PostgreSQL)

New KPIs: **Generated posts** (sum of results in completed `content_generation` jobs) and **Posts with images** (saved posts with a chosen image). "Needs review" is the pending-approval count. The other eight KPIs are unchanged in meaning.

Two new panels from `GET /dashboard/summary` (additive fields `content_stats`, `competitor_stats`):

| content_stats | Definition |
| --- | --- |
| generation_jobs_completed / failed / active | `content_generation` jobs by status (active = queued or running) |
| generated_posts | Results in completed generation jobs |
| saved_from_generation / manual_posts | Saved posts with / without a generation link |
| images_generated / images_uploaded | `post_assets` by `source` |
| posts_with_images | Posts whose `primary_asset_id` is set |

| competitor_stats | Definition (removed competitors excluded) |
| --- | --- |
| tracked | Non-removed competitors |
| researched | Those with at least one saved research result |
| approved | `selection_status = approved` |
| informing_generation | Approved, researched, verified or partially verified, i.e. exactly the set passed to content generation |

No reach, engagement, follower or publishing-success figure is shown or inferred. `publishing_available` and `analytics_available` remain `false`.

### Post Library

- **Thumbnails** use the post's chosen image (`primary_asset_id`), falling back to the newest asset for older posts.
- **Filters** add `created_from` / `created_to` (inclusive local dates in the **company timezone**; an inverted range is rejected with 422 and flagged in the UI) and `media=with_image|text_only`. The overview's "Posts with images" card links to `?media=with_image`. **Clear filters** appears whenever a filter is active, including in the empty state.
- **Rows and cards** show hashtags and image counts, plus quick actions: copy caption (with hashtags), download image, approve (draft or needs-review), duplicate (copies the chosen image), archive/restore. All use the existing revision-checked APIs; a stale row returns 409 and asks for a reload.
- The full editor (Open post) adds the Phase 2 image panel (generate/regenerate, upload, choose, download), caption regeneration and version history.

### API changes

| Route | Change |
| --- | --- |
| `GET /companies/{id}/dashboard/summary` | + `content_stats`, `competitor_stats` (additive, with defaults) |
| `GET /companies/{id}/post-library` | + `created_from`, `created_to` (dates), `media`; `preview_asset_id` now prefers the chosen image |

Both remain read-only GETs, company-scoped (404 for non-members) and bounded. No migration was needed for this phase; Phases 1–2 added `c4e1a9b27d10` and `e8f3c2a61b45` (see the competitor and content handoffs).

### Verification

- Backend `tests/test_crm_dashboard_stats.py` (3 tests): exact content and competitor statistics against seeded jobs, posts, assets and competitors (including removed and failed ones); the date filter at a company-timezone day boundary (23:30 vs 00:30 IST); the inverted-range 422; the image filter; thumbnail = chosen image, not newest; tenant isolation. The existing CRM tests (query bounds, read-only) still pass.
- Browser `tests/e2e/crm-dashboard.spec.ts`: nav labels and order, every KPI value equal to the records the test created, KPI → filtered library, image and date filters with clear, copy (clipboard content checked), approve, duplicate, archive/restore, card view, the overview reflecting those actions, sidebar collapse persisting across reload, and no horizontal overflow at 768 and 375 px.
- Updated assertions (UI intentionally changed; no checks removed): `journey.spec.ts` now expects 10 KPI cards instead of 8; `crm.spec.ts` expects the "Companies & Brands" heading.
- Screenshots: `frontend/artifacts/crm-overview-desktop.png`, `crm-overview-tablet.png`, `crm-overview-mobile.png`, `crm-library-desktop.png`, `crm-library-tablet.png`, `crm-library-mobile.png`.

### Files

New: `backend/tests/test_crm_dashboard_stats.py`, `frontend/tests/e2e/crm-dashboard.spec.ts`.
Changed: `backend/app/services/crm.py`, `backend/app/schemas/crm.py`, `backend/app/api/crm.py`, `frontend/src/components/dashboard/shell.tsx`, `frontend/src/components/dashboard/crm-overview.tsx`, `frontend/src/components/dashboard/companies.tsx`, `frontend/src/components/dashboard/posts.tsx`, `frontend/src/components/content/post-library.tsx`, `frontend/src/lib/crm-api.ts`, `frontend/src/app/dashboard/[section]/page.tsx`, `frontend/src/app/crm.css`, `frontend/tests/e2e/journey.spec.ts`, `frontend/tests/e2e/crm.spec.ts`.

### Final regression (17 Nov 2026, end of Phases 1–4)

| Check | Result |
| --- | --- |
| Backend suite | **270 passed** |
| Frontend unit | **60 passed** |
| TypeScript, ESLint | Passed |
| Production build (`next build`) | Passed |
| Alembic | Head `e8f3c2a61b45`; `alembic check` reports no pending operations |
| Complete browser suite (32 tests, one run) | **31 passed, 1 failed**: the live shared-worker scheduling wait timed out during an unusually slow 1.6 h run. The worker was verified alive and processing due schedules, and `scheduling.spec.ts` then **passed 3/3** in a focused recheck with no code change. This is not one uninterrupted all-green run. |
| Data preservation | All **3,309** baseline rows present; every pre-existing column value byte-identical (re-hashed over original columns). 620 additional rows belong to labelled e2e/smoke test accounts. |
| Environment files | `backend/.env` and root `.env` hashes unchanged |

### Still honest-unavailable

Social Accounts and Analytics keep their explicit "not connected" states. OAuth, publishing and engagement analytics remain Phase 8.

## Phase 7.5 handoff (historical)

Implemented 16 November 2026 on the existing Next.js/React/TypeScript, FastAPI, SQLAlchemy and PostgreSQL application. This phase changes the authenticated workspace experience and adds bounded read projections. It does not replace authentication, onboarding, brand extraction, Gemini generation, competitor research, content persistence, approval, private media, scheduling, audit history or the shared worker.

## Audit and architecture

The repository already contained extensive uncommitted work. Source/configuration/document hashes and all original rows across the 16 application tables were captured before implementation; no reset, deletion, migration rewrite or dependency/framework replacement was used.

The audit found that the current Overview still rendered local demo posts and decorative sample charts, while real posts, jobs, media, schedules and approval APIs already existed. The shell had a global demo badge, sample notifications, a promotional panel and misleading browser-only persistence copy. My Posts already supported important mutations but its default library lacked sortable dates, related schedules/media, exact pagination totals and generation history. Company selection and complete month/week scheduling already worked.

The implementation therefore reuses:

- Existing HttpOnly cookie session restoration, trusted-Origin policy and workspace role helpers.
- Existing company selection and onboarding/brand editors for setup, business edits, preferences and explicit reanalysis.
- Existing `posts`, `post_assets`, `ai_jobs`, `post_schedules` and `schedule_events`; no new entity or table.
- Existing post creation/approval/duplicate/archive APIs and private asset route.
- Existing saved-post editor and schedule form, with a revision-reload action that preserves entered text.
- Existing real Calendar and worker. Calendar gains links from CRM records and initial status selection, without changing its UTC/DST policy or processing logic.

```text
Verified cookie session + selected authorized company
                     |
      +--------------+----------------+
      |              |                |
 CRM summary     Post Library    Company directory
 aggregates      + history       workspace-scoped
      |              |                |
      +----- existing PostgreSQL records --------+
                     |
          existing revision-checked writes
                     |
        post editor -> approval -> schedule form
                     |
        existing calendar + shared due worker
```

Historical handoffs remain unchanged. Their descriptions of earlier mock-only phases do not override the current source.

## Screens and information architecture

The existing routes remain stable:

| Route | Screen |
| --- | --- |
| `/dashboard` | Real company-scoped workspace overview |
| `/dashboard/companies` | New Companies / Brands directory |
| `/dashboard/content-studio` | Existing AI Content Studio |
| `/dashboard/posts` | Post Library, including a separate Generation history tab |
| `/dashboard/competitors` | Existing competitor records/research |
| `/dashboard/calendar` | Existing company-backed Content Calendar |
| `/dashboard/brand` | Existing company/brand editor, reached from company management |
| `/dashboard/analytics` | Honest unavailable-integration state; sample performance charts removed |
| `/dashboard/accounts` | Social Accounts and informational integration requirements |
| `/dashboard/settings` | Existing workspace/session/local-preview settings, with accurate labels |

The compact persistent desktop sidebar includes Overview, Companies / Brands, AI Content Studio, Post Library, Competitors, Content Calendar, Analytics, Social Accounts and Settings. The top bar exposes workspace context, company selection, saved-post search, Create Post and the account menu. Fake notifications, global demo mode and the sidebar promotion are removed.

Mobile keeps the collapsible navigation, company selector, an accessible Create Post icon, account menu, horizontally contained tables and a card alternative. Hidden navigation is removed from keyboard visibility, Escape closes it, and library tabs support arrow/Home/End navigation. Scoped `crm.css` retains Jet Black `#0b0b0b`, Hot Pink `#ff2dab` and Chartreuse `#d4ee3e`; it does not change onboarding or marketing layout rules or stored customer visuals. Existing routes need no aliases or redirects.

## Overview metrics and semantics

Overview shows the **active company's** records, not totals across unrelated companies/workspaces. It never substitutes demo counts when an API fails. The header identifies the current company; data refreshes on focus, every 30 seconds while visible, and through Refresh overview.

| Metric | Exact definition |
| --- | --- |
| Total saved posts | Count of `posts` rows for the company across draft, ready_for_review, approved and archived |
| Draft posts | Posts whose status is exactly `draft` |
| Needs review | Posts whose status is exactly `ready_for_review` |
| Approved posts | Posts whose status is exactly `approved`, whether scheduled or not |
| Archived posts | Posts whose status is exactly `archived`; these rows remain retained |
| Scheduled posts | Distinct post IDs with a schedule whose status is exactly `scheduled`, including any due items still waiting for the worker |
| Awaiting publisher | Distinct post IDs with a schedule whose status is exactly `awaiting_publisher` |
| Blocked schedules | Number of schedule records whose status is exactly `blocked` |

The four post-status counts sum to Total saved posts. **Do not add schedule metrics to post counts:** they describe a separate dimension. For example, one approved post with a schedule counts once as approved and once as scheduled; a changed draft may also have a blocked schedule. Cancelled/failed schedule records do not count as scheduled posts. No publication-success or engagement count is inferred.

Additional sections:

- Six most recently updated saved posts, including archived rows, ordered by update time and stable ID.
- Up to five upcoming **future** scheduled events in company time. Due holding-state items are reached through the Awaiting publisher card and Calendar.
- Five posts awaiting approval: ready_for_review first, then drafts; newest update within each priority.
- Six real scheduling audit events with links to their schedule details. Displayed titles are the current saved post titles, not an invented historical content snapshot.
- Four recent generation jobs, clearly separated from saved posts, plus a link to retained history.
- Navigation actions for creation, library, companies and blocked plans.
- An honest publishing/analytics integration status. No reach, impressions, engagement, follower counts or creative-growth percentages are displayed.

## Post Library behavior

Saved posts are retrieved from PostgreSQL immediately after authentication/company selection. Refresh and a new login restore the same records. Unsaved generated results are not silently converted into posts, and browser demo cards are not presented as company records.

The default table provides title/caption preview, platform/content type, post status, creation/update dates, a representative related schedule and actions. A card view presents the same records. The latest available private asset can be shown as a thumbnail; the full saved-post editor continues to list associated images through existing authenticated media APIs.

Library controls:

- Literal substring search over title or caption; company-scoped, with SQL wildcard escaping.
- Active-company switching using the existing selection API/hook. Incomplete company setup follows the existing onboarding guard.
- Platform and post-status filters.
- Creation/update sort, ascending or descending, with stable post-ID tie-breaking.
- Exact total and offset pagination; 25 rows per UI page. Empty/filter/error/loading states are explicit.
- Existing full post editor for caption/hashtags, approval, duplication, archive/restore, images and approved scheduling.
- New manual-draft action using the existing post-create API; no AI job is required.
- Explicit browser-draft import using the original stable creation keys; imports retain browser drafts and do not reinterpret demo schedules.

Dates use the company's effective timezone returned in the library response. Scheduling links preserve the original planning timezone and open real Calendar details. A representative schedule prioritizes an active scheduled/awaiting_publisher/blocked record, then the most recently updated record, with stable ID ordering. This is **one related schedule**, not a replacement for full retained calendar/history records.

Before opening a post, the library fetches its current server version. Writes retain the existing optimistic revision check and never silently retry a conflict. **Reload saved revision** refreshes the revision/status/server baseline while keeping locally entered text for review and explicit saving. Edits to approved text still require draft/reapproval and still block related schedules through the original database guard. Merely reapproving does not reactivate a blocked plan.

The UI separates post status from schedule status throughout; a scheduled or awaiting-publisher post is not labelled published.

## Retained generation history and recovery

The Generation history tab reads actual company `ai_jobs` of kind `content_generation`, paginated independently from posts. Rows show topic, actual job status, creation date, completed result count and explicitly linked saved results. Only persisted `generation_job_id`/`result_index` relationships establish that a result was saved; matching text or old mock cards do not establish provenance.

Review results uses the existing completed-result API. Recovery submits an explicitly reviewed result through the existing post-create endpoint with its job ID, result index and the same company/job/index browser creation-key convention as Studio. Existing database uniqueness and provenance checks prevent duplicate result posts. Already-saved results link to the saved draft and are never overwritten from immutable generation output.

No mount effect queues a job, spends provider quota or fabricates a completed generation. Pending/failed results remain honestly unavailable. Existing brand-revision protection remains: an unsaved result from a changed brand may be rejected with a conflict and must be regenerated or reviewed as a separate manual draft. The original result/history remains retained.

## Company management and calendar integration

Companies / Brands is a paginated workspace-scoped directory, searchable by company name/description. Cards show saved company information, real brand confirmation, selected content platforms and onboarding state. Details display the existing company/brand/preferences bundle. Open posts and Manage brand first use the existing company selector, then navigate to the permitted route. Add company/new workspace reuse the existing setup flow. Review or reanalyze brand navigates to the existing editor; it does not start research without explicit user action.

The completed scheduling system remains the source of truth. CRM links use `/dashboard/calendar?schedule={real-id}` and KPI links use `?status=scheduled|awaiting_publisher|blocked`. The existing month/week navigation, filters, event details, reschedule/cancel, readiness, audit history, company-keyed cleanup, visible-page polling and timezone behavior remain intact. A direct schedule link opens its details even if the event lies outside the currently displayed grid interval. Calendar filters still apply to the visible period.

Due schedules remain `awaiting_publisher`. OAuth, platform delivery, fictional publication IDs and real analytics are not introduced. The shared-worker entrypoint remains `python -m app.workers.extraction`; this phase does not change worker code or add another polling queue.

## Exact API changes

All new routes reuse authenticated cookie sessions, `request_policy`, typed Pydantic responses and existing membership authorization. Inaccessible companies/workspaces return 404, missing sessions return 401, and invalid parameters return 422. Members can read these projections. All mutations still use the existing owner/admin APIs and trusted-Origin/revision checks. These GET endpoints never enqueue jobs or mutate records.

| New GET route under `/api/v1` | Query and response |
| --- | --- |
| `/companies/{company_id}/dashboard/summary` | Company counts/capabilities, timezone, recent posts, approval queue, upcoming schedules, audit activity and recent generations |
| `/companies/{company_id}/post-library` | `q` ≤200 characters; canonical `platform`; post `status`; `sort=created_desc|created_asc|updated_desc|updated_asc` (default updated_desc); `limit` 1–100/default 25; `offset` ≥0 |
| `/companies/{company_id}/generation-history` | `limit` 1–100/default 20; `offset` ≥0; only content-generation jobs |
| `/workspaces/{workspace_id}/company-directory` | `q` ≤200; `limit` 1–100/default 25; `offset` ≥0; joins existing brand/preferences/progress |

Library response shape:

```json
{
  "company_timezone": "Asia/Kolkata",
  "items": [],
  "total": 0,
  "limit": 25,
  "offset": 0
}
```

Each item extends the existing safe post response with `schedule: ScheduleResponse|null`, `asset_count`, and `preview_asset_id: UUID|null`. The original post responses also gain **additive `created_at` and `updated_at` fields** from existing columns. No write schema, post ID, revision, source content or generation link changes. The frontend permits missing dates only for existing legacy contract fixtures, displaying Unavailable rather than inventing dates.

Generation pages return `{items,total,limit,offset}`. Each item contains `id,status,stage,created_at,completed_at,topic,result_count,saved_results,error_message`; each saved-result reference is `{result_index,post_id}`. The full internal job payload, brand context, credentials and raw provider details are not exposed. Completed content remains available through the existing authorized result endpoint.

Directory pages return `{items,total,limit,offset}` with existing company response fields plus `brand_confirmed`, `brand_name`, `platforms` and `onboarding_status`.

Summary lists are bounded at six recent posts, five approval items, five upcoming schedules, six audit events and four generation jobs. Post and schedule counts use separate SQL aggregates to avoid join multiplication. Library queries use scalar related-record projections plus at most one bounded schedule fetch, rather than one query per post. Generation saved references are fetched in one company/job-scoped query. Directory uses joined existing one-to-one records. Existing company/post indexes constrain tenant filtering; no unproven index migration is added.

## Database and data preservation

**No migration or database model change.** Alembic remains at **`ba56aacf52ad`**, and schema comparison reports no pending operations. Previous migrations, model constraints, scheduling state/UTC/DST policy, triggers, audit records and private media files are preserved.

The baseline captured **1,399 original rows across 16 application tables**. Verification compares original IDs and row-value hashes, allowing additional isolated test fixtures and reporting live-state differences explicitly. Backend tests use existing rollback fixtures; browser and true-concurrency tests retain their clearly identified committed test accounts/companies/records. No original record is removed or edited to make tests pass. Provider calls are mocked in ordinary regressions; the new recovery browser test seeds a clearly labelled completed **test fixture** job only under an `e2e-*@example.com` account, then exercises real history and save APIs. It does not pretend the fixture was generated by Gemini.

All six previous handoff documents are preserved. `.env`, earlier migrations, authentication, company/onboarding services, generation/competitor services, worker source and scheduling persistence/state rules are unchanged.

The final preservation audit found **1,398 matching original row-value hashes and no missing original rows**. All original posts, users, companies, brands, preferences, jobs/results, assets, schedules and audit events match their baseline values. **One preexisting `onboarding_progress` row changed while the live application was open**; it is now in_progress at current_step business, revision 6. This is consistent with the existing onboarding navigation API, which changes current_step/revision, but that API has no request-origin audit trail, so the exact initiating browser action is not asserted. The live navigation state was retained rather than overwritten. The new CRM GET routes are independently tested to issue no INSERT/UPDATE/DELETE statements.

Separate read-only smoke queries verified that **all 28 preexisting saved posts and all three preexisting content-generation jobs** remain visible through the new company-scoped library/history projections. No original result was recreated to make it appear in history.

## Verification

Current completed checks:

| Check | Result |
| --- | --- |
| Backend full regression | **208 passed** |
| Frontend unit regression | **44 passed** |
| Complete browser regression | **24 passed** |
| New CRM browser journeys | **4 passed** in the targeted run |
| Existing Studio/scheduling targeted regression | **4 passed** |
| TypeScript / full ESLint | Passed |
| Optimized production build | Passed |
| Alembic schema comparison | Passed; no new upgrade operations |

The first complete browser run exposed a stale assertion for the intentionally removed decorative welcome banner. It was replaced with assertions that all eight actual KPI cards have loaded and are visible. The four-width overflow checks were retained and Companies / Brands was added to the sweep (32 route loads plus dashboard captures). The targeted responsive run and final complete 24-test run passed. No existing test was disabled or deleted.

Backend CRM tests cover genuine empty/count states, post-versus-schedule semantics, blocked/due states, bounded approval/recent lists, search/sort/pagination/dates, positive and empty asset metadata, schedule linkage, generation/save provenance, member/anonymous/foreign tenant access, directory confirmation, query-count bounds and read-only behavior of every new GET route. Existing authentication, onboarding, fetching, providers, competitor, content, media, timezone, state and worker tests remain enabled.

New real-browser journeys cover:

1. Manual draft creation in the library, company switching, a new login and retained saved content.
2. A 26-post company with exact overview counts, search/filters/sorting, pagination, table/card views, safe concurrent edits, revision reload preserving text, duplication, approval, archive/restore and a real blocked-schedule link.
3. A retained test generation result recovered into exactly one real saved post, reopened through its URL and restored after refresh.
4. Company directory/confirmation details, mobile company selection and an honest unavailable analytics screen.

Desktop and mobile screenshots are captured and opened for visual inspection, including populated data rather than loading placeholders:

```text
frontend/artifacts/crm-overview-desktop.png
frontend/artifacts/crm-overview-mobile.png
frontend/artifacts/crm-library-desktop.png
frontend/artifacts/crm-library-mobile.png
frontend/artifacts/crm-companies-mobile.png
```

The main checks use 1440px and 375px views. Existing responsive regression also sweeps 768px/1024px, and the live scheduling regression observes the actual shared worker reach Awaiting Publisher. Browser tests use the local development server with actual FastAPI/PostgreSQL; the production artifact is separately built. Authentication guard assertions were updated to the new Workspace overview heading without removing their positive, expired/unavailable-session or denied-access checks.

Run from the existing service directories:

```powershell
# backend/ — PostgreSQL available
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m alembic check

# frontend/ — API and the existing shared worker running for browser tests
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

No new service, package or secret is required. Existing startup remains:

```powershell
# project root
docker compose up -d postgres pgadmin
# backend/ — API terminal
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
# backend/ — separate shared-worker terminal
.\.venv\Scripts\python.exe -m app.workers.extraction
# frontend/ — frontend terminal
npm run dev
```

## Modified-file inventory for this phase

New files:

```text
backend/app/api/crm.py
backend/app/schemas/crm.py
backend/app/services/crm.py
backend/scripts/seed_crm_browser_generation.py
backend/tests/test_crm.py
frontend/src/app/crm.css
frontend/src/components/content/generation-history.tsx
frontend/src/components/content/post-library.tsx
frontend/src/components/dashboard/companies.tsx
frontend/src/components/dashboard/crm-overview.tsx
frontend/src/components/dashboard/crm-ui.tsx
frontend/src/lib/crm-api.ts
frontend/src/store/use-crm-read.ts
frontend/tests/e2e/crm.spec.ts
frontend/tests/unit/crm-api.test.ts
docs/crm-dashboard.md
```

Updated existing files:

```text
backend/app/main.py                                     register CRM read router
backend/app/schemas/content.py                          additive existing post timestamps
frontend/src/app/layout.tsx                             scoped CRM CSS and accurate metadata
frontend/src/app/dashboard/[section]/page.tsx            companies route, CRM headings and query links
frontend/src/components/company-controls.tsx             accurate persistence copy
frontend/src/components/content/real-content.tsx         reuse editor/fields, safe revision reload
frontend/src/components/dashboard/calendar.tsx          initial CRM schedule/status links
frontend/src/components/dashboard/overview.tsx          stable adapter to the real overview
frontend/src/components/dashboard/posts.tsx             real Post Library as default
frontend/src/components/dashboard/real-calendar.tsx     CRM headings and initial detail/filter state
frontend/src/components/dashboard/sections.tsx          honest integrations/analytics/settings
frontend/src/components/dashboard/shell.tsx             professional authenticated shell
frontend/src/lib/content-api.ts                         additive timestamp parsing
frontend/tests/e2e/auth.spec.ts                         updated heading assertions, same guard checks
frontend/tests/e2e/journey.spec.ts                      updated overview assertion, same complete journey
```

This is **31 source/document files** for this phase. Generated screenshots, build output, caches and tracked bytecode are not intentional source changes. Earlier dirty Git entries and prior smoke/cleanup scripts are preexisting work.

## Known limitations and Phase 8

- Overview metrics belong to the active company; cross-workspace aggregate reporting is not added.
- Library search is a literal company-scoped substring search, not a full-text relevance engine. Any additional search/index work should follow real data-volume profiling.
- A library row shows one representative schedule; full retained records and event history remain in Calendar.
- Generation recovery preserves the existing brand/provenance rules; changed-brand results can require a fresh generation or an explicitly reviewed manual draft. No original result is deleted.
- Company changes and brand/preferences edits still use the existing separate revision-checked requests and onboarding invalidation policy.
- Registered account updates, notifications, account connection and platform analytics are not invented. Existing local display settings remain explicitly labelled; real account/session limitations remain in the authentication handoff.
- There are no OAuth tokens, real connected accounts, delivery confirmations, real publishing, engagement APIs or billing changes. Phase 8 still requires secure platform authorization/token storage, tenant-safe social-account relationships, media validation, durable publication attempts/idempotency/reconciliation, retries/rate limits and verified delivery before any Published status or engagement analytics can be shown.
