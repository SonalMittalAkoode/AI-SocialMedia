# Real website research and Gemini brand extraction

Phase 4 adds real website acquisition, structured Gemini analysis, a durable PostgreSQL queue, result history, and explicit selected-field approval. It reuses the existing cookie authentication, workspace roles, company/brand models, revision policy, onboarding routes, and UI components. Competitors, posts, creative generation, scheduling, publishing, and analytics remain mocks. The previous authentication and company-onboarding handoffs are preserved as historical documents.

## Architecture and operation

```text
Existing onboarding / Brand editor
  → authenticated POST extraction
  → PostgreSQL queued job (transactional enqueue)
  → separate Python worker claims with FOR UPDATE SKIP LOCKED
  → guarded HTTPX fetch → HTML/metadata cleaning
  → Gemini structured inference → local schema/evidence validation
  → result + completed job committed together
  → browser polls and shows editable findings / source passages
  → explicit selected-field apply with company and brand revisions
  → existing brand confirmation endpoint
```

PostgreSQL itself is the durable queue, avoiding an enqueue/database dual-write gap or a new Redis dependency. A committed queued record is the work item. The API does no crawling or model inference and does not start an in-process background task. Run the worker separately; without it jobs remain accurately queued. Multiple worker processes can claim independently. Each processes one job at a time.

Start the existing database/API/frontend as documented in the README, apply migrations, and open an additional backend terminal:

```powershell
cd D:\sonal-akoode\AISocialMedia\backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.workers.extraction
```

The worker owns a reusable Gemini client and closes its async and sync resources on shutdown. Worker logs contain job IDs, failure categories, page counts, and elapsed time. HTTP library request logging is suppressed in the worker to avoid logging submitted query strings. No key, cookie, raw provider exception, or full prompt is returned to the browser or logged by application handlers.

## Website fetching and security boundary

- Only HTTP(S) on its standard 80/443 port is accepted. Credentials, malformed URLs, unsupported ports/schemes, localhost/internal names, private/local/link-local/multicast/reserved addresses, unusual numeric address forms, and IPv6 transition mappings are rejected.
- Every new socket resolves the requested hostname, rejects the entire DNS answer set if any destination is non-public, then connects to a validated numeric IP. HTTPcore retains the original hostname for TLS verification/SNI and the HTTP Host header. A later DNS change cannot redirect that socket. Reused connections are disabled. Unit tests verify both pinning and SNI/Host preservation using a fake socket.
- HTTPX environment proxy trust is disabled. TLS verification stays enabled. The transport uses the pinned HTTPX 0.28.1 / HTTPcore 1.0.9 interfaces, including HTTPX's internal pool adapter and HTTPcore's network backend. Review and rerun socket/security tests when upgrading either dependency.
- Redirects are handled manually and revalidated. Crawled pages and redirects must remain on the submitted origin. Cross-host and HTTP→HTTPS redirects fail closed: submit the final canonical public URL instead. Robots checks run before every redirected page request.
- Robots rules for `SocialAIResearchBot` and `*`, crawl delays, and request rates are respected. A required delay beyond the job's supported limits causes a restriction failure. Missing robots (404/410) permits normal access; unavailable/restricted robots fails closed. Explicit `noai` directives and obvious access-challenge titles are rejected. The crawler never executes JavaScript, bypasses a challenge, authenticates to a site, downloads assets, or follows external links.
- Bodies are read as raw bounded streams, at most 2,000,000 bytes per response. Requests advertise identity encoding; servers returning compressed bodies are rejected to avoid decompression bombs. Only HTML/XHTML pages are accepted; robots accepts text/plain or HTML. At most five pages and three redirects per request are allowed.

The homepage supplies a bounded set of discovered about/service/product/contact links. There is no general-purpose spider, sitemap crawler, browser rendering, or external social scraping. HTML cleaning removes scripts, styles, forms, hidden content, repeated paragraphs, navigation/footer clutter, and cookie banners. Extracted data includes titles/descriptions/Open Graph metadata, canonical/favicon references, headings, visible text, supported organization JSON-LD, contact link values, and supported social links. Asset URLs are metadata only; no logo/image is downloaded. Footer contact links and supported structured contact data are captured before removing layout clutter. Duplicate text is removed across pages.

Typed `WebsitePage`/`WebsiteContent` boundaries bound parser output. Main text defaults to 30,000 characters total. Up to 120 bounded source passages are prepared for Gemini, with an additional 80,000-character serialized-input ceiling; oversized inputs fail safely. Raw HTML and full cleaned pages are ephemeral and discarded after execution. Persisted results retain bounded evidence passages, page URLs/titles, structured findings, warnings, and usage metadata. Old results are retained; there is no automatic deletion policy or raw-content archive.

## Gemini configuration, output, and evidence

Reuse the existing private settings; no environment file or secret was replaced:

```dotenv
GEMINI_API_KEY=your_existing_private_key
GEMINI_MODEL=your_verified_model
```

Installed/recorded SDK: `google-genai==3.3.0`. The verified environment uses `gemini-2.5-flash`; application services always read `settings.GEMINI_MODEL`. JSON mode for that model requires explicit `v1beta`. The wire schema retains structure/types/enums/nullability while omitting costly length/pattern/array decoding constraints that this model rejects. The full Pydantic constraints remain mandatory after generation. The current call uses an 8,000-token ceiling, 512-token thinking budget, temperature 0.1, disabled automatic function calls, a 35-second SDK timeout, and a tighter 20-second coroutine deadline per generation. Review these capabilities before changing to a model with different thinking/structured-output support.

The system instruction treats every website passage as untrusted data, forbids operational instructions/tools/secrets, distinguishes facts/inferences/suggestions, and requests null/empty unknowns. The provider receives public extracted passages and their server-assigned IDs, not cookies, database credentials, other tenants' data, or executable HTML.

The model returns typed company/brand fields plus citations by source ID. The server attaches the actual retrieved URL and passage. It does not accept model-written quotations as evidence. Unknown citations and explicit values absent from the cited passage fail validation. Scalar paraphrases are labelled inferred. Every populated field/list item needs corresponding evidence; social URLs must have actually been retrieved; colors require explicit source support. This verifies provenance and literal support, not the truth of website claims or semantic correctness of every inference. Confidence is heuristic, not calibrated.

One main request is attempted. Invalid/empty/truncated output or a first-call timeout permits one compact correction request constrained to a supported company name, description, and citations. A successful compact correction clearly warns that other fields remain unknown. If correction still fails, the job fails safely. Unsupported or invented results are never silently used as a fictional business profile. Token counts, model identifier, and analysis version are stored when provided by the SDK.

References checked against the installed SDK: [Google GenAI SDK](https://googleapis.github.io/python-genai/), [official structured-output documentation](https://aistudio.google.com/docs/structured-output), and [HTTPcore network backend interface](https://github.com/encode/httpcore/blob/master/httpcore/_backends/base.py).

## Job lifecycle, limits, and recovery

States are `queued → running → completed/failed`, with bounded transient requeue. Real stages are queued, fetching, cleaning, analyzing, saving, completed, and failed. Cancelled is reserved in the schema; there is no cancellation endpoint in this phase. UI animations are indeterminate; no simulated percentages are presented as measurements.

Claims persist an attempt count and a random lease token. Each stage/result update checks the active lease. Result insertion and completion share a transaction, with one result per job. Stale/crashed leases are reconciled on worker polling; exhausted attempts or execution budget produce a controlled failure. An old worker cannot publish after losing its lease. No database transaction remains open while waiting for website or Gemini responses.

Default controls (`EXTRACTION_` environment prefix, optional; existing .env untouched):

| Setting | Default |
| --- | --- |
| `MAX_PAGES` | 5 (maximum 5) |
| `REQUEST_TIMEOUT` | 10 seconds |
| `JOB_TIMEOUT` | 60 seconds cumulative active execution budget |
| `MAX_BYTES` | 2,000,000 per response |
| `MAX_TEXT` | 30,000 characters |
| `MAX_REDIRECTS` | 3 |
| `MAX_ATTEMPTS` | 2 (maximum 3) |
| `MAX_QUEUE` | 100 queued/running jobs |
| `COMPANY_HOURLY_LIMIT` | 6 creations |
| `USER_HOURLY_LIMIT` | 12 creations |

Queue admission uses a PostgreSQL advisory transaction lock and per-company row lock. There is at most one active job per company. Identical active submissions reuse the same job; a different URL conflicts. Completed same-company/same-URL work can be reused for ten minutes unless `reanalyze: true` is explicitly requested. No cross-tenant cache is used. Quota failures do not automatically repeat expensive provider calls. Transient failures can requeue with five-second attempt-scaled backoff while execution budget remains. Queue waiting/backoff is outside active processing time; stale lease detection has a 20-second grace period. A failed analysis can be explicitly retried as a new history entry.

Async deadlines bound network/model work; parsing and short synchronous SQLAlchemy operations are bounded by input/connect limits rather than a separate hard-kill process. A dedicated process sandbox/egress firewall and distributed production abuse controls are future hardening work, not prerequisites hidden behind a simulated implementation.

## Database

Migration `4d84ba137a8a` follows `6dc2c3a509f5`. Its reviewed upgrade creates only two new tables and associated indexes/constraints. It does not alter existing users, companies, brands, or onboarding tables. No records, tables, or volumes were reset. Existing migration files were not rewritten. Do not downgrade a populated installation: downgrade drops the extraction tables.

| Table | Important fields and constraints |
| --- | --- |
| `brand_extraction_jobs` | UUID; RESTRICT company/requesting-user FKs; requested URL; checked status/stage and attempt range; lease token/expiry; available/start/end/create/update timestamps; safe error category/message; page count/duration; company index; status/available claim index; partial unique active-company index; unique job/company pair |
| `brand_extraction_results` | UUID; unique job ID; indexed company FK; composite RESTRICT job/company FK prevents mismatched tenant linkage; JSONB findings/evidence/page metadata/warnings/token usage; hybrid method, model, analysis version, timestamp |

The worker never changes approved brand/company records. Selected approval validates both company and brand revisions, adapts values through the existing company/brand schemas, and composes shared onboarding transaction/assign/invalidation helpers in one transaction. Only selected fields are updated. Recommendations append labelled lines to existing Content guidelines without replacing unrelated instructions. Material changes remove confirmation and invalidate the brand/later steps according to the existing policy. The existing confirmation endpoint remains authoritative. Later manual edits/confirmation can label the editable brand source manual; immutable analysis provenance remains in the extraction result.

## API contracts and authorization

All paths below are relative to `/api/v1/companies/{company_id}/brand-extractions`. They reuse the existing current-user, membership, role, no-store, and Origin policies. Members can read; owners/admins can create/apply. Missing/inaccessible tenant resources return 404. Job IDs are additionally scoped to the company.

| Method / path | Contract |
| --- | --- |
| POST empty suffix | `{url, reanalyze?: false}` → 202 job summary, including safe dedupe/reuse |
| GET empty suffix | Paginated history: `offset=0`, `limit=20`, maximum 100; newest first |
| GET `/{job_id}` | Status/stage, attempt count, timestamps, safe error category/message |
| GET `/{job_id}/result` | Completed structured findings, source evidence, warnings, page metadata, model/version; 409 processing, 422 failed/cancelled, 404 unavailable |
| POST `/{job_id}/apply` | `{company_revision, brand_revision, fields: {selected_field: edited_value}}`; requires a completed result and compatible populated findings; returns new company/brand revisions |

Supported approval keys: company_name, industry, business_type, description, tagline, target_audience, products_services, brand_voice, brand_keywords, brand_colors, social_links, city, country, value_proposition, content_pillars, suggested_content_tone. Lists remain lists, social links remain a supported-platform URL object, and recommendation values map to labelled guidelines. Unknown/unavailable fields cannot be approved through this endpoint. Public requests cannot supply source/confirmation flags or ownership.

Errors include unsafe URL/destination, DNS failure, redirect/body/input limits, restricted/404/unavailable websites, insufficient content, timeouts, Gemini quota/unavailability, invalid AI output, stale revisions, worker interruption, and storage failure. No raw provider exceptions or SQL statements are returned. A status connection failure does not cancel a persisted job.

## Frontend behavior and manual demo

The business screen's existing analysis area now creates a real job and shows real stages. The existing Brand editor exposes research/history in a details panel. It restores the newest relevant server job on refresh/login/company change, polls active status about every 1.8 seconds, and stops at a terminal state/unmount/error. Initial empty-history reconciliation is bounded; effects never create jobs. History currently exposes the latest twenty entries in the UI; older records remain available through the paginated API.

Findings show current saved values, changed-field markers, classification/confidence, editable inputs, actual source passages, and links. Nothing is selected automatically. Lists use one item per line and social links use a JSON object. Before selected application, the existing browser form is retained as an explicitly recoverable draft. Conflicts preserve review edits and offer the existing reload/recovery controls. Website retrieval or model failure offers retry/change URL/manual entry; no fictional fallback is generated.

Manual demo:

1. Start the API, frontend, PostgreSQL, and worker.
2. Register/login and enter a business name and its final canonical public website URL, for example `https://basecamp.com`. Website availability/policies and provider quota may change.
3. Click **Analyze my business**. Wait for actual queued/fetching/analyzing/completed state; refreshing resumes the server job.
4. Expand findings and compare them with the saved brand. Edit values, select only the approved fields, then click **Apply selected findings**.
5. Review the existing Brand identity form and click **Confirm brand identity**. Continue through the unchanged mock competitor/content workflow.
6. Reanalyze from the Brand editor to compare new results; previously confirmed data remains untouched until explicit approval.

Two opt-in live smoke tools create retained smoke accounts/companies and consume Gemini quota; default automated tests never require live Gemini:

```powershell
# backend/; worker/API must already be running
.\.venv\Scripts\python.exe scripts/smoke_brand_extraction.py https://basecamp.com
# frontend/; also requires the running frontend
$env:RUN_LIVE_EXTRACTION='1'
node scripts/live-extraction.mjs https://basecamp.com
```

The browser tool checks actual research/review/selected apply, refresh restoration, explicit confirmation, and overflow at 375/1440px. Screenshots are written to `frontend/artifacts/live-extraction-375.png` and `live-extraction-1440.png`.

## Verification

Use `python -m pytest` from backend with the new `pytest.ini` (`testpaths=tests`). This keeps the user's existing standalone live `test_gemini.py` connection check outside ordinary CI discovery. Backend integration tests use rollback transactions and company-scoped queue claims; they do not delete existing records. Browser regression tests create retained accounts/companies. Extraction UI tests mock provider/job responses while using real authenticated company fixtures.

```powershell
# backend/
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m alembic check
# frontend/
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
```

Final measured results on 2026-11-14:

| Check | Result |
| --- | --- |
| `python -m pytest -q` | 115 passed, including all original authentication/onboarding tests |
| `alembic check` | Passed; no new upgrade operations detected |
| `python -m pip check` | No broken requirements |
| `npm run lint` / `npm run typecheck` | Passed |
| `npm test` | 37 passed across four files |
| `npm run build` | Passed; optimized compilation, TypeScript, and page generation |
| `npx playwright test` | All 15 passed in 1.9 minutes, including all existing auth/company/mock-content regressions and three extraction UI checks |
| Live API smoke against Basecamp | Completed with four source pages; unapproved brand unchanged; selected name applied unconfirmed |
| Opt-in live browser smoke against Basecamp | Passed real fetch/Gemini/status/review/selected name+description apply/refresh/confirmation; 375/1440px overflow checks passed and screenshots inspected |
| Latest live result | Four pages, 27 evidence entries, model `gemini-2.5-flash`, stored execution duration about 11.9 seconds; 3,894 prompt, 1,437 output and 461 thinking tokens (5,792 total) |
| Database verification | Head `4d84ba137a8a`; 65 users, 51 workspaces, 57 companies with 57 brand/preferences/progress rows each; no incomplete company initialization; eight retained extraction jobs (two completed, six diagnostic failures), two results |

During implementation, live checks exposed the v1 JSON-mode restriction, the model's excessive schema-decoding constraints, truncated verbose output, and unreliable model-written quotes. The final adapter uses v1beta, a compatible wire schema, bounded generation/correction, and server-attached retrieved passages. Failed smoke jobs were retained and never replaced brand data. The final live browser run succeeded with the full analysis rather than a fictional fallback. Ordinary CI uses mocked Gemini responses and never requires provider credentials or live generation. A preexisting Vite config-loader compatibility warning and Playwright color-environment warning remain informational; there are no unresolved test failures.

## Exact Phase 4 file inventory

Created:

- `backend/app/core/extraction_config.py`
- `backend/app/models/brand_extraction.py`
- `backend/app/schemas/brand_extraction.py`
- `backend/app/schemas/website.py`
- `backend/app/services/extraction_errors.py`
- `backend/app/services/website_fetcher.py`
- `backend/app/services/html_extractor.py`
- `backend/app/services/website_extraction.py`
- `backend/app/services/gemini_brand_analyzer.py`
- `backend/app/services/extraction_jobs.py`
- `backend/app/workers/__init__.py`
- `backend/app/workers/extraction.py`
- `backend/app/api/brand_extractions.py`
- `backend/alembic/versions/4d84ba137a8a_add_durable_brand_extraction_jobs_and_.py`
- `backend/pytest.ini`
- `backend/tests/test_website_extraction.py`
- `backend/tests/test_gemini_brand.py`
- `backend/tests/test_extraction_jobs.py`
- `backend/scripts/smoke_brand_extraction.py`
- `frontend/src/lib/brand-extraction-api.ts`
- `frontend/src/components/brand-extraction.tsx`
- `frontend/tests/unit/brand-extraction.test.ts`
- `frontend/tests/e2e/extraction.spec.ts`
- `frontend/scripts/live-extraction.mjs`
- `docs/brand-extraction.md`

Modified:

- `backend/requirements.txt` — record installed Gemini/HTTP/parsing dependencies; convert the existing UTF-16 manifest to UTF-8 for normal source tooling.
- `backend/alembic/env.py` — register extraction metadata.
- `backend/app/main.py` — include extraction routes.
- `frontend/src/store/use-company-persistence.ts` — prepare new companies and apply approved findings with current revisions and recovery backup.
- `frontend/src/lib/company-api.ts` — expose optional brand keywords for accurate comparison.
- `frontend/src/components/onboarding.tsx` — replace simulated analysis with real research/review and accurate help copy; preserve manual entry.
- `frontend/src/components/brand-form.tsx` — expose research/history using the existing editor/layout.
- `frontend/tests/e2e/journey.spec.ts` — keep the fictional-URL mock-content regression on the manual path.
- `README.md` — worker startup, real research behavior, and handoff link.

Preexisting uncommitted Phase 2/3 and user Gemini configuration/test changes remain in place. This inventory describes Phase 4 source changes; generated tracked bytecode may also change when Python imports run. No secrets, environment files, prior migrations, or prior handoff documents were rewritten.

## Known limitations and next phase

JavaScript-only, authenticated, paywalled, access-challenged, disallowed, compressed-only, cross-origin-redirecting, or oversized websites can fail intentionally. Network availability, site policy, and provider quota remain external constraints. Some analyses may validate only name/description; other fields remain explicitly unknown. Evidence proves retrieval/literal support, not business truth. Inferences still require human review. No logo downloads, media inference, persistent browser worker, cancellation UI, automatic raw-content retention/deletion, team invitations, or production egress infrastructure were added.

Before real competitor discovery, add an approved discovery/search source, explicit crawl scope and policy rules, per-workspace cost budgets, competitor-specific evidence/provenance models, deduplication and review, queue monitoring/alerts, extraction quality evaluation, and stronger production egress/abuse controls. Competitor discovery must not silently expand this company-origin crawler into an unrestricted external spider. Existing authentication production requirements remain in the authentication handoff.
