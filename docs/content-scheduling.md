# Content scheduling — Phase 7C–7F implementation

Updated 16 November 2026. Approved saved posts now have authenticated scheduling APIs, PostgreSQL-backed calendar views, explicit rescheduling/cancellation and due processing in the existing shared worker. **No social publishing exists.** Due schedules stop at `awaiting_publisher`; post approval is separate from scheduling state.

The original 7A/7B checkpoint is retained below as historical context. Its statements about missing APIs/worker/frontend describe that earlier checkpoint, not the implementation documented here.

## API contracts

All paths below are under `/api/v1/companies/{company_id}`. Authentication uses the existing HttpOnly cookie and trusted-Origin policy. Workspace members can read; only owners/admins can write. Inaccessible companies, posts and schedules return 404. Missing authentication returns 401. Mutations use company → post → schedule lock order and existing transactional error handling. No external call occurs while holding these locks.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/scheduling-preferences` | `{timezone: string|null, effective_timezone: string, revision: integer}` |
| PATCH | `/scheduling-preferences` | Required company `revision`, required IANA `timezone` or null; stale revision 409 |
| POST | `/schedules` | Create approved post schedule; 201 typed schedule, or same resource for an identical key replay |
| GET | `/schedules` | UTC `start` inclusive / `end` exclusive (offsets required), optional `platform`, `status`, `limit` 1–100 (default 50), `offset` ≥0 |
| GET | `/schedules/{id}` | Company-scoped calendar projection including current post/readiness details |
| PATCH | `/schedules/{id}` | Required schedule `revision`, approved `post_revision`, future local plan; retain schedule ID |
| POST | `/schedules/{id}/cancel` | `{revision: integer}`; already-cancelled replay returns unchanged record, including with its earlier revision |
| GET | `/schedules/{id}/events` | Append-only history, ordered by schedule revision; limit 1–100/default 50, offset ≥0 |
| GET | `/calendar` | Required date-only `start_date` inclusive / `end_date` exclusive in effective company timezone; maximum 62 days; platform/status filters, limit 1–100/default 100, offset ≥0 |

Canonical platforms remain **Instagram, LinkedIn, Facebook, X**, matching existing posts. The target must match the approved draft. An edited platform requires approval and a new schedule after cancelling the old one. Unknown fields, invalid plans, unapproved/archived/stale post revisions and DST errors return 422. Stale schedule/company writes, duplicate active plans and changed-body key reuse return 409. Storage errors use the existing sanitized service responses.

Example creation (replace UUIDs with actual existing company/post/request IDs):

```json
{
  "post_id": "11111111-1111-4111-8111-111111111111",
  "post_revision": 2,
  "target_platform": "LinkedIn",
  "local_date": "2026-11-20",
  "local_time": "10:00",
  "timezone": "Asia/Kolkata",
  "fold": null,
  "idempotency_key": "22222222-2222-4222-8222-222222222222"
}
```

The response includes `id`, `company_id`, `post_id`, `target_platform`, `scheduled_at: "2026-11-20T04:30:00Z"`, `timezone`, `status: "scheduled"`, `post_revision`, `revision: 1`, and nullable `failure_code`, `failure_message`, `claimed_at`, `cancelled_at`. IDs in this example illustrate the contract; the application always uses real persisted IDs.

Rescheduling sends the same local plan fields plus the **current schedule revision**, without post ID, platform or idempotency key. Listings/details/calendar add `company_timezone`, `title`, a bounded `preview`, `approval_status`, `current_post_revision`, and `readiness_warnings`. `timezone` retains the original schedule planning zone; `company_timezone` is the current effective display zone. Responses never include a publication ID or publishing success.

An initial request is fingerprinted after Pydantic normalization. The permanent company/key identifies that original request, so its identical replay returns the same schedule even after rescheduling, cancellation or a company default-zone change. Reusing it with different input returns 409. A browser request key is retained across a lost acknowledgement and removed only after success or a definitive client error. The existing partial unique index prevents a second active plan, including while blocked or awaiting a publisher.

## Database and audit history

The completed `457c6b4357a7` scheduling migration, models, timezone utilities and state machine remain unchanged. One supplemental, reviewed migration **`ba56aacf52ad`**, following that revision, has been applied. It adds `schedule_events`, its schedule index, unique `(schedule_id, schedule_revision)`, event/fingerprint checks, audit function/trigger and an append-only update/delete guard. It does not recreate or backfill existing tables, rewrite migrations, reset data or change secrets.

Database-generated events record creation, rescheduling, cancellation, blocking, due transitions and failure in the same transaction as the schedule. Each records old/new status/time, schedule revision, approved post revision, planning timezone, timestamp and authenticated actor when supplied by the scheduling service. Background transitions and post-invalidation triggers without an actor context use NULL. Captions, provider payloads and secrets are not copied into history. The creation event retains only a SHA-256 request fingerprint, excluded from the public history response. Cancellation replay creates no event. History cannot be updated/deleted, and event foreign keys restrict removal of the related schedule/user.

Existing approval guards continue to block changed/unapproved/archived posts. Reapproval alone does not reactivate a plan. The current approved revision and a new future instant must be supplied through explicit rescheduling. Cancelled/failed states remain terminal. A replay of a pre-event-history internal schedule lacking a creation fingerprint fails safely with 409 rather than guessing request identity.

## Timezone behavior

Company timezone is optional. NULL uses `SCHEDULING_DEFAULT_TIMEZONE`, default `Asia/Kolkata`, without backfilling company records. A request may choose a valid IANA planning zone; omission uses the company's effective zone. Local times require minute precision and no offset. Existing conversion utilities reject past instants and nonexistent DST times; repeated wall times require explicit `fold: 0` or `1`. UTC TIMESTAMPTZ is authoritative.

Company-zone changes affect calendar grouping and defaults for future plans, not previously stored instants or original planning zones. Calendar date boundaries are converted by the backend with the existing half-open local date-range policy. Frontend date arithmetic uses date-only UTC keys and groups every instant through `Intl.DateTimeFormat` with the **company's** IANA zone. Browser-local dates never determine real event placement. Calendar preferences refresh on focus and at the visible-page polling interval without replacing unsaved timezone input.

## Shared worker and crash recovery

The entrypoint remains **`python -m app.workers.extraction`**. Its brand extraction and typed AI handlers are preserved. One scheduling coroutine is started inside this existing process and runs bounded synchronous SQL work in `asyncio.to_thread`, so long Gemini/network awaits do not starve due checks. No web-server startup hook, second broker, OAuth client or external social queue is added.

`process_due` prioritizes companies with the oldest due schedule, locks company → post → schedule with `FOR UPDATE SKIP LOCKED`, rechecks due status/time and the current approved post revision/platform, then commits `awaiting_publisher` plus its audit event atomically. Defensive eligibility failure blocks the item using a controlled reason. It never edits the post or calls a publisher. Other replicas skip locked rows. API edits/cancellation take the same company lock, so concurrent intent cannot be silently overwritten.

Each item has a short transaction; a batch is bounded by item count and a two-second processing budget. A crash before commit rolls back its claim/transition; after commit its non-scheduled state excludes it from subsequent claims. No long-running lease is necessary for this local atomic transition. Database outages roll back the current transaction and retry after a minimum five-second backoff. Earlier committed items remain durable.

Optional settings (existing `.env` was **not edited**):

| Setting | Default | Bounds |
| --- | --- | --- |
| `SCHEDULING_POLL_SECONDS` | 2 | 0.2–60 seconds |
| `SCHEDULING_BATCH_SIZE` | 20 | 1–100 items |
| `SCHEDULING_DEFAULT_TIMEZONE` | Asia/Kolkata | Valid IANA name |

Logs contain schedule/company IDs and controlled state/storage messages, never captions, provider exception strings or credentials. Start a single shared-worker process for a normal local setup; additional replicas are supported by database claims. Restart workers after code/config changes; they do not hot-reload with Uvicorn.

## Frontend integration

- **My Posts:** an unchanged, approved saved draft exposes the real Schedule form. Date, time, timezone and DST occurrence are validated by the API. A fresh GET verifies the approved post revision before submission. Double clicks are fenced while a request is running; success appears only after acknowledgement. Scheduling does not create another post.
- **Content Studio:** save the generated result using the existing provenance/idempotency API, then choose **Review & schedule saved draft**. This fetches that same persisted post, reuses the approval editor and schedules only its approved version. Reopening fetches current server state.
- **Calendar:** company-backed events are the default. Existing month/week layout, navigation, colors and responsive scrolling are retained. Platform/status filters, paged event loading, details, readiness warnings, original timezone/UTC time, history, explicit rescheduling, cancellation and company timezone preferences use real APIs. Visible-page refresh every 15 seconds and focus refresh expose worker transitions. Company-keyed mounting clears events/dialogs on a switch. Details reload current revisions and preserve entered reschedule fields rather than silently replacing edits.
- **Demo:** browser events and local editors remain available only through **View demo calendar**, labeled as samples. Local drafts are retained; none are automatically converted into real schedules.

All five scheduling states display their actual names. Due events show: **“Publishing integration is not connected yet. This post remains saved and awaiting publication.”** Cancellation retains the schedule, audit history and source post. Empty/unauthorized/unavailable/error states do not substitute demo events or pretend a request succeeded.

## Verification and preservation

Final completed regression: **202 backend tests passed**, **41 frontend unit tests passed**, and **20 browser tests passed**. TypeScript, full ESLint, production build, Alembic schema comparison and Git whitespace checks passed. Migration head is **`ba56aacf52ad`**. The earlier 19-test browser run was extended with the real shared-worker due-state/company-switching journey; the final full run includes all 20 tests with none disabled.

Backend coverage includes authorized and member/foreign/anonymous access, creation/replay/duplicate protection, stale updates, UTC/DST validation, filters/ranges, reschedule/cancel/replay, approval invalidation, timezone changes, append-only history, bounded due batches, true independent-connection worker competition, rollback recovery, transient storage retry and scheduler progress during a long AI handler. The independently running shared worker can also win an isolated concurrency fixture; the invariant is one committed due event across all contenders.

Most backend fixtures roll back. Real worker concurrency and browser journeys require isolated committed test users/workspaces/companies/posts/schedules; these are retained, clearly identified test records. No unrelated records are deleted. Baseline hashes compare all **853 original rows across 15 application tables: zero missing or changed**, including the original 123 users, 122 companies, five posts, AI/extraction jobs and results. Added fixtures are permitted additions, not a database reset. Original `.env`, 7A/7B schema/policy utilities, all prior migrations, authentication modules and other handoff documents match baseline hashes.

Routine browser tests mock provider responses/unavailable image capability and use the real persistence/authentication API. They do not spend Gemini/image quota or claim to revalidate live provider credentials/model availability. Existing content/extraction/competitor backend regressions remain enabled. Screenshot artifacts are under `frontend/artifacts/scheduling-*.png`.

Run verification with PostgreSQL available, from the indicated directories:

```powershell
# backend/
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m alembic current

# frontend/
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The live due-worker browser test needs the shared worker running alongside API/frontend; it schedules an isolated approved post at the next safely future UTC minute and observes the real transition. Browser tests run with one worker, including a Los Angeles browser and Kolkata company to verify grouping across UTC date boundaries, refresh/session restoration, reschedule/cancel, company isolation and 375/1440px layouts.

Browser verification also exercised the real Studio → saved draft → approval → scheduling path without creating a second post, rejection of past dates while preserving inputs, prevention of double submission, empty approved-post selection, cancellation retaining the post, filters and week/month controls. Desktop, mobile and awaiting-publisher screenshots were opened and visually reviewed. The browser regression used the existing local frontend development server and actual FastAPI/PostgreSQL/shared worker; the production artifact was separately built successfully.

## Exact service startup commands

Use separate PowerShell terminals. Keep the existing environment files/credentials; no new package or secret is required.

```powershell
# Terminal 1 — project root; retain existing Docker volumes
Set-Location D:\sonal-akoode\AISocialMedia
docker compose up -d postgres pgadmin

# Terminal 2 — API, after PostgreSQL is healthy
Set-Location D:\sonal-akoode\AISocialMedia\backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 3 — shared durable worker
Set-Location D:\sonal-akoode\AISocialMedia\backend
.\.venv\Scripts\python.exe -m app.workers.extraction

# Terminal 4 — frontend development
Set-Location D:\sonal-akoode\AISocialMedia\frontend
npm run dev

# Production frontend alternative in Terminal 4
npm run build
npm run start
```

Frontend: `http://localhost:3000`; API docs: `http://localhost:8000/docs`; PostgreSQL: `127.0.0.1:5433`; PgAdmin: `http://localhost:5050`. Do not run dev and production frontends on the same port, duplicate local workers unnecessarily, downgrade populated scheduling history, or remove Docker volumes.

## Phase 8 readiness and remaining limits

Phase 7 supplies approved durable plans, stable tenant ownership, revision fencing, cancellation, auditability, due holding state and a real calendar. It is ready to support a deliberate publishing phase, not to claim platform delivery. Phase 8 still needs authenticated connected accounts and tenant-safe foreign keys, encrypted token lifecycle, platform/media validation, publication attempts with durable external-call idempotency and reconciliation, retries/rate limits/webhooks and verified delivery confirmations. The current `social_account_id IS NULL` guard must change through a reviewed migration when real account storage exists.

There are no recurrence rules, bulk scheduling, cross-platform copies, drag/drop scheduling, real account connections or automatic publishing in this implementation. Browser refresh is periodic rather than push-based. History is operational and append-only, not a claim of a separately privileged tamper-proof audit service. Provider configuration/search availability remains an independent preexisting deployment concern.

## Exact Phase 7C–7F file inventory

New files:

```text
backend/alembic/versions/ba56aacf52ad_add_immutable_scheduling_event_history.py
backend/app/api/scheduling.py
backend/app/models/schedule_events.py
backend/app/schemas/scheduling.py
backend/app/services/scheduling.py
backend/app/workers/scheduling.py
backend/tests/test_scheduling_api.py
backend/tests/test_scheduling_worker.py
frontend/src/lib/scheduling-api.ts
frontend/src/components/content/schedule-form.tsx
frontend/src/components/dashboard/real-calendar.tsx
frontend/tests/unit/scheduling.test.ts
frontend/tests/e2e/scheduling.spec.ts
```

Updated existing files:

```text
backend/alembic/env.py                                  register audit model
backend/app/main.py                                     register scheduling router
backend/app/core/scheduling_config.py                    bounded worker settings
backend/app/workers/extraction.py                        integrate scheduler lifecycle
frontend/src/components/content/real-content.tsx         approved saved-post/Studio actions
frontend/src/components/dashboard/calendar.tsx          real default, explicit demo mode
frontend/tests/e2e/intelligence.spec.ts                  Studio scheduling and quota-safe image error fixture
frontend/tests/e2e/journey.spec.ts                       explicit demo calendar selection
docs/content-scheduling.md                              current contracts, evidence and handoff
```

The extensive preexisting dirty tree contains earlier phases. The inventory above describes this implementation only. Tracked Python bytecode can change when imported by tests and is generated output, not an intentional source change.

---

# Historical content scheduling — Phase 7A / 7B checkpoint

Verified 16 November 2026. This checkpoint implements the architecture audit, scheduling storage, timezone policy and state machine. **It does not implement Phase 7C scheduling APIs, Phase 7D worker processing, or Phase 7E calendar integration.** There is no user-facing real scheduling journey yet. The existing calendar continues to be a labelled browser-local demo.

## Audit of the existing system

The five earlier handoffs were reviewed alongside the actual models, routers, worker, calendar, frontend types and tests. Their historical feature descriptions are not treated as the current schema.

| Existing component | Finding and reuse decision |
| --- | --- |
| `app/models/content.py` | `posts` already owns content, company/user IDs, optimistic revision, platform and draft/ready_for_review/approved/archived status; do not recreate it or add scheduling/publication states to posts |
| `app/api/content.py` | Existing approval is explicit and revision-checked; edited approved text must first become a draft. Archive/restore use PATCH. Reuse this approval system |
| `post_assets` | Private, company-scoped asset metadata; no social account or publication confirmation exists |
| `Editable` | Reuse UUID, revision, timestamps and SQLAlchemy version checks for schedules |
| Company model | No timezone field existed; add one nullable IANA choice without assigning every tenant an Indian timezone |
| Permissions | Existing workspace membership and company access helpers provide membership reads and owner/admin writes; future scheduling endpoints must reuse these |
| Shared worker | `app.workers.extraction` handles brand jobs and typed AI jobs with short transactions. It is unchanged in this checkpoint; a later due-schedule handler belongs in the same process architecture |
| Calendar | Existing month/week views use local JavaScript Date and browser `state.posts`; events match naive `scheduledAt` strings on demo `Scheduled` posts |
| Demo editor | `mockSchedulePost` and `datetime-local` perform browser-local planning. Preserve these until explicit real/demo integration is implemented |
| Frontend types/storage | `GeneratedPost` and local company caches remain demo-oriented. Real schedules require a separate typed API contract in 7C/7E; do not reinterpret or auto-import demo dates |
| Migration baseline | Database was at `42e2d03f6e9d`; all prior migration files remain unchanged |

No external provider call, environment-secret edit, dependency change, authentication change, publishing request or frontend mutation was needed for this checkpoint.

## Database changes

Applied revision **`457c6b4357a7`**, following `42e2d03f6e9d`.

### Company timezone

`companies.timezone VARCHAR(100) NULL` is the explicit company IANA timezone choice. NULL means no choice has been made. The migration leaves all existing companies unset; it does not backfill a universal timezone or change existing company revisions/timestamps. ORM and database validation reject unknown names. Existing onboarding request/response contracts are unchanged; exposing timezone selection is subsequent API/UI work.

The application policy provides `SCHEDULING_DEFAULT_TIMEZONE`, default `Asia/Kolkata`, through `SchedulingSettings`. Call `effective_timezone(company.timezone, scheduling_settings.default_timezone)` in future scheduling services. An explicit company choice wins, and invalid input never silently falls back. Changing the fallback only affects unspecified display/default choices, not stored schedule instants.

### `post_schedules`

| Fields | Purpose |
| --- | --- |
| `id`, `company_id`, `post_id`, `created_by` | UUID identity and ownership; RESTRICT foreign keys |
| `target_platform` | Existing canonical values: Instagram, LinkedIn, Facebook, X; must match the approved post |
| `social_account_id` | Nullable UUID reserved for Phase 8; a Phase 7 CHECK requires NULL, with no foreign key to a nonexistent table |
| `scheduled_at` | Required finite TIMESTAMPTZ instant; ORM binds/results normalize to UTC and reject naive Python datetimes |
| `timezone` | Required valid IANA planning timezone, retained independently of later company display changes |
| `status` | scheduled / awaiting_publisher / blocked / cancelled / failed |
| `post_revision` | Exact approved source-post revision validated at creation/rescheduling |
| `idempotency_key` | Required company-scoped UUID, following existing creation-key conventions |
| `revision`, `created_at`, `updated_at` | Existing optimistic-concurrency convention and timestamps |
| `claimed_at`, `cancelled_at` | Transition timestamps; cancellation remains retained |
| `failure_code`, `failure_message` | Controlled approval/internal-error classifications; database guards replace arbitrary exception text |

Constraints include:

- Composite `(post_id, company_id) -> posts(id, company_id)` foreign key, plus company/user foreign keys, with RESTRICT deletion.
- Permanent unique `(company_id, idempotency_key)` across all states. A different company may reuse the same UUID.
- Partial unique `(company_id, post_id, target_platform)` while scheduled, awaiting_publisher **or blocked**. A blocked item retains its slot until explicitly rescheduled or cancelled.
- Platform/status checks, positive post/schedule revisions, finite timestamps, IANA names, controlled account availability and cancellation/failure/claim consistency.
- `ix_schedule_calendar(company_id, scheduled_at, id)` for bounded company calendar intervals and stable pagination.
- Partial due index `(scheduled_at, id) WHERE status='scheduled'`.
- Post/company index for reverse lookup and invalidation.

No snapshot, duplicate approval entity, extra queue framework or unrelated table was added. A separate event-history table is deferred: terminal cancellation records remain immutable, and full operational audit events can be considered when implementing services/worker transitions.

## State machine

| State | Meaning | Allowed next state |
| --- | --- | --- |
| scheduled | Current approved revision planned for a future instant | Explicit reschedule, awaiting_publisher when due, blocked, cancelled, failed |
| awaiting_publisher | Planned time arrived; no external delivery has occurred | Explicit reschedule, blocked, cancelled, failed |
| blocked | Content changed, was unapproved or archived; review is required | Explicit reschedule using the current approved revision, or cancellation |
| cancelled | User intent cancelled; original record/timestamp retained | Terminal; repeated cancellation is a no-op |
| failed | Genuine terminal scheduling error | Terminal; reviewed retry creates a new schedule/key |

No publishing, published or fake external delivery state is introduced. Missing account/publisher capability is not a failure: the due policy returns awaiting_publisher.

Pure policy functions in `services/scheduling_policy.py` define eligibility, transitions and due-time decisions. They perform no database writes, authorization lookup or worker processing. Returning to scheduled requires explicit intent and future-time validation. Database guards independently reject invalid persisted transitions, immutable-identity changes, premature due transitions and invalid approved revisions.

## Approval and revision safety

Selected policy: **invalidate and explicitly reschedule**, rather than keep a copied content snapshot.

The database schedule guard requires the current company-owned post to be approved, at the exact recorded revision and matching platform, when creating or reactivating a schedule. It locks the source post while checking eligibility. New schedules must start scheduled with a future instant. Past timestamps are allowed to age naturally after creation; there is no moving `CHECK scheduled_at > now()` that would invalidate an otherwise valid historical row.

The `block_schedules_on_post_change` trigger blocks active schedules whenever an existing post row changes. It preserves the original planned instant and recorded approved revision. The schedule guard advances the schedule revision and updated timestamp, so already-loaded stale ORM edits fail their version check. Codes distinguish changed, unapproved and archived content. Trigger messages are fixed safe text.

Reapproval alone does not reactivate a blocked schedule. Subsequent authorized services must explicitly validate and capture the newly approved revision and a future plan. Target platform/post/company/creator/key identity is immutable: if the post platform changes, cancel the old item and create a schedule matching the new platform. Cancellation does not delete the post. Cancelled/failed schedule records cannot be resurrected. Cancelling twice preserves the first timestamp and version.

These guarantees are already database-enforced even though no scheduling route exists. Existing post APIs are unchanged; tests verify that their approved edits and archive behavior trigger blocking without changing unrelated post data.

## Timezone and DST policy

`core/timezones.py` uses Python `zoneinfo`; existing `tzdata` is already a backend dependency for Windows support. ORM/database names are validated against their respective timezone databases. Keep application and PostgreSQL timezone data current/aligned; unknown names fail closed rather than falling back.

- Accept naive wall-clock input only through `local_to_utc`, with a separate IANA zone and optional explicit fold.
- Validate by converting both fold candidates to UTC and round-tripping to the supplied local clock.
- Nonexistent local times always fail, including half-hour DST gaps and whole skipped dates.
- Ambiguous local times fail without an explicit `fold=0` (earlier) or `fold=1` (later). Invalid fold choices are rejected.
- Already-aware timestamps are handled separately as instants by `as_utc`. Do not mix them with local-wall input or let PostgreSQL silently interpret naive application datetimes.
- Future scheduling is strictly greater than the supplied server clock; no skew allowance is added. The DB guard checks `statement_timestamp()` on creation/rescheduling, avoiding stale transaction-start time.
- Calendar date intervals are half-open `[start, end)` and convert both company-local boundaries separately. DST days can span 23 or 25 hours. Exceptional ambiguous/nonexistent local midnights fail explicitly; a future API must request explicit boundaries or report the validation error rather than silently shifting them.
- Changing a company timezone does not rewrite `scheduled_at`, the schedule planning timezone, or post revisions. Display uses the selected company timezone; the original planning zone remains available for explanation.

Example: **20 November 2026, 10:00 Asia/Kolkata → 20 November 2026, 04:30 UTC**.

References used for the policy: [Python 3.11 zoneinfo](https://docs.python.org/3.11/library/zoneinfo.html), [PostgreSQL 16 date/time types](https://www.postgresql.org/docs/16/datatype-datetime.html). PostgreSQL stores the instant rather than the original zone name, which is why a separate IANA timezone field is retained.

## Migration and preservation verification

The reviewed upgrade adds one table, one nullable company column, constraints/indexes and three database functions with two triggers. It neither recreates posts nor updates existing data. Alembic autogeneration does not fully compare functions, triggers or CHECK constraints: the missing company CHECK was added explicitly before applying this revision, and catalog/behavior tests verify these database objects.

Before migration, hashes of existing rows in all 14 application tables and source/config/handoff files were captured. After migration and automated tests:

- Original row IDs and values match across all 14 tables, excluding only the new company timezone column.
- **123 users, 122 companies and 5 posts remain preserved.**
- `post_schedules` has zero retained test records; tests use the existing connection-level rollback fixtures.
- Only two preexisting source files changed: the company ORM model and Alembic model registration.
- Existing `.env`, previous migrations, routers, worker source, frontend and historical handoffs match their baseline hashes.

No downgrade was executed. The conventional downgrade removes the new scheduling objects and timezone column; do not run it against a populated scheduling installation without a separate migration/data-retention plan.

## Verification commands and results

Run from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m pytest tests/test_scheduling_policy.py tests/test_scheduling_models.py -q
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m alembic current
```

Results: **50 new scheduling/timezone tests passed**, **185 backend tests passed in total**, migration head `457c6b4357a7`, and no schema drift detected. The initial focused pass had 48 tests; two additional positive due-state/failure tests were then added and passed in the full run.

Coverage includes schema catalog/index/trigger checks, actual PostgreSQL inserts and transitions, cross-company references, company-scoped keys, duplicate active records, blocked slots, unapproved/archived/stale posts, past/naive/infinite timestamps, valid/invalid IANA zones, company-zone changes, DST gaps/folds, non-hour gaps, skipped dates, 23/25-hour date intervals, edit invalidation, explicit reapproval/rescheduling, optimistic stale-write fencing, terminal cancellation/failure, safe errors and the absence of a publication-success state.

One bounded PostgreSQL sleep exercises a real positive due transition against its statement clock; no polling worker, Gemini call, social API or external publishing request is used. Existing backend tests remain enabled and unchanged. Frontend/unit/browser/build checks are not rerun in this backend-only checkpoint because frontend source/contracts and worker processing are unchanged; the earlier Phase 6 results remain historical, not newly claimed results.

## Scope boundary and next checkpoints

**APIs:** None added or changed. The full prompt's create/list/detail/update/cancel/calendar endpoints belong to 7C. HTTP authorization, request replay responses, stale-schedule 409 handling, readiness warnings, range pagination and timezone selection remain to be integrated there. A database foreign key is not a substitute for checking the authenticated workspace member.

**Transactions:** Future services should lock company → post → schedule, then apply eligibility/revision/transition policy in one short transaction. The source post must be locked before a schedule when combining both; reverse lock order can deadlock with post invalidation. Acquire a current approved revision explicitly, handle uniqueness violations, and treat replayed identical creation keys as the same resource while rejecting changed-body reuse. Do not hold these locks over external calls.

**Worker:** No new polling loop, scheduled-task runner, claim processor or publisher was added. The later shared-worker handler can discover due IDs through the partial index, acquire company/post/schedule locks consistently with `SKIP LOCKED` where appropriate, revalidate revisions and transition locally in one transaction. Since Phase 7 has no external delivery call, it need not introduce a second broker or a long-running processing state. Retry/recovery and multi-worker concurrency tests belong to 7D; model due-transition tests do not claim those guarantees.

**Frontend:** Calendar month/week views, My Posts, Content Studio, demo caches and onboarding are untouched. No user-facing Schedule button or real-calendar event is claimed. A manual end-to-end scheduling demo is unavailable until 7C–7E are implemented; the commands above verify this foundation without persisting test schedules.

**Phase 8:** Must add genuine connected-account ownership/foreign keys, publication attempts, platform credentials and delivery confirmation separately. The Phase 7 social-account NULL restriction will need a deliberate migration at that time. An Instagram plan does not imply publish readiness; appropriate media/account/provider validation is still future integration work. No imaginary account IDs or publication results are generated here.

## Files in this checkpoint

Created:

- `backend/app/core/timezones.py`
- `backend/app/core/scheduling_config.py`
- `backend/app/models/scheduling.py`
- `backend/app/services/scheduling_policy.py`
- `backend/alembic/versions/457c6b4357a7_add_real_post_scheduling_and_timezone_.py`
- `backend/tests/test_scheduling_policy.py`
- `backend/tests/test_scheduling_models.py`
- `docs/content-scheduling.md`

Updated:

- `backend/app/models/onboarding.py` — nullable validated company timezone only.
- `backend/alembic/env.py` — register scheduling metadata for comparison/migrations.

The repository already contained extensive uncommitted Phase 2–6 work. This inventory describes only Phase 7A/7B additions; it is not a claim that the rest of the dirty Git tree was created in this checkpoint.
