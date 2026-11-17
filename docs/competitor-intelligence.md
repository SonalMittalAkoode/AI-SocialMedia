# Competitor intelligence

## Workspace UI redesign — 17 November 2026 (latest)

Frontend-only redesign of Competitor Intelligence in the CRM (`/dashboard/competitors`) and onboarding step 3. No backend, API, model, migration, Gemini configuration or `.env` change. Discovery, research, persistence, tenant isolation and grounding compliance are unchanged.

### Structure

- **Header:** "Know your competition. Stay ahead." with subtitle, the active company and industry (from the saved company profile), **Discover competitors ✦** and **Add competitor**.
- **Summary (CRM only):** Saved, Researched, Approved and Research-in-progress counts, all derived from `GET /competitors` and `GET /ai-jobs?kind=competitor_research`.
- **Tabs** with real counts: **Discover**, **My Competitors**, **Research Queue**, **Approved Insights**. Onboarding shows only Discover and My Competitors. The default tab is My Competitors when competitors exist, otherwise Discover.
- **Discover:** the company's industry, location, services and audience as chips, the required information message, and the grounded result.
- **My Competitors:** a 3/2/1-column card grid or a table. Search, industry, research, verification and approval filters, four sorts, clear filters, bulk selection with **Research selected**. Each card has an initials avatar (no fabricated logos), industry, 3-line description, website, location, relevance score marked *heuristic*, up to 3 research themes plus "+N more", and three distinct status indicators (research / identity / review) with explanatory tooltips. Actions are View insights plus Research website or Reanalyze, and a keyboard-accessible ⋯ menu offering only actions valid for the record's state. Removal asks for confirmation and remains a soft remove.
- **Details drawer:** right side at 580 px (full screen on mobile). Sections: Overview, Competitive relevance, Key strengths (with the website fact each is based on), Content strategy, Supporting evidence (source links), Research information (with history picker). Findings are labelled **Verified from website**, **AI interpretation** or **Strategic suggestion**. The sticky footer offers Approve / Reject / Reanalyze as applicable.
- **Research Queue:** real worker jobs with status, stage, requested time and attempts. Retry for failed jobs, View insights for completed ones, Cancel for queued or running ones (existing cancel API). No simulated percentages. It polls only while jobs are active, so progress is restored after refresh.
- **Approved Insights:** approved competitors, market observations, common themes (with counts across competitors), opportunities (attributed to the competitor whose research produced them) and evidence links, with provenance labels. **Create content with these insights** links to AI Content Studio and does not start a generation. Approved, researched competitors are already part of every new generation's context.
- **Empty states** use the exact copy specified (watchlist, discovery, research, approval, queue, no matches, discovery failed), with Lucide icons.

### Grounded results presentation (compliance unchanged)

`frontend/src/lib/grounded-markdown.ts` parses headings, numbered and bulleted (nested) lists, bold, italic, code and paragraphs into a data tree rendered with React elements only. HTML in the answer is shown as text, so it is sanitised by construction. Citations are inserted at their original UTF-16 offsets before parsing and render as compact numbered links (`Source N: title`). Top-level list items, which in Gemini answers are usually one per business, are styled as numbered blocks. Their content and order are unchanged; nothing is extracted, ranked, summarised, rewritten or saved. A **Sources (N)** section lists every source. Grounding links are Google redirect URLs, shown as supplied and labelled "via Google Search". Google Search Suggestions keep the same sandboxed iframe. There are still no Save/Approve/Import/Research actions on the result, and nothing is written to storage.

### Onboarding

Step 3 uses the same workspace without metric cards or the Queue and Insights tabs. Its title and description use the new copy. Bottom navigation is **Back to brand identity**, **Skip for now** and **Continue to preferences**. Skip and Continue use the existing step-completion request, so validation, progress and persistence are unchanged and research stays optional.

### Permissions

The client does not know the user's workspace role. Mutations remain owner/admin-only on the server (403 for members), and a permission error appears as a toast.

### Verification

- Live: one real Gemini grounded search through the UI returned 5 competitors with 10 sources. They rendered as numbered sections with inline citations, with no raw Markdown left and no 375 px overflow. Google's 4 suggestion chips rendered in the frame. Screenshots: `frontend/artifacts/competitor-discover-live-desktop.png`, `competitor-discover-live-mobile.png`.
- Unit: `tests/unit/grounded-markdown.test.ts` (7 tests: blocks, numbering, nesting, emphasis edge cases, HTML as text, citation offsets/merging, citations inside bold). Frontend total **70 passed**.
- Browser: `tests/e2e/competitor-research.spec.ts` rewritten for the redesign (2 tests): every empty state, Markdown and citations and sources, bulk add, card contents, filters, sort, table view, drawer sections and provenance, approve, confirmed remove and restore, real bulk research reaching a handled failure in the queue with Retry, Approved Insights, 768 and 375 px layouts with a full-screen drawer, and the onboarding layout and Skip.
- Updated existing tests (interactions moved, assertions kept): `intelligence.spec.ts` approves via the card menu and rejects via the drawer; `grounded-search.spec.ts` uses the discovery-failure "Add competitor" fallback; `journey.spec.ts` and `real-onboarding.spec.ts` click "Continue to preferences".
- TypeScript, ESLint and the production build pass. The backend suite (288) still passes.

Screenshots: `frontend/artifacts/competitor-discover-desktop.png`, `competitor-intelligence-desktop.png`, `competitor-intelligence-tablet.png`, `competitor-intelligence-mobile.png`, `competitor-drawer-desktop.png`, `competitor-drawer-mobile.png`, `competitor-onboarding-desktop.png`, `competitor-onboarding-mobile.png`.

### Files

New: `frontend/src/components/competitors/{workspace,discover,my-competitors,drawer,queue-and-insights,dialogs,shared}.tsx`, `frontend/src/components/competitors/use-competitor-data.ts`, `frontend/src/lib/grounded-markdown.ts`, `frontend/src/app/competitors.css`, `frontend/tests/unit/grounded-markdown.test.ts`.

Changed: `frontend/src/components/real-competitors.tsx` (now a thin re-export), `frontend/src/components/competitors.tsx` (passes the onboarding variant), `frontend/src/app/dashboard/[section]/page.tsx` (workspace renders its own header), `frontend/src/components/onboarding.tsx` (step 3 copy and navigation), `frontend/src/app/layout.tsx` (stylesheet import), `frontend/tests/e2e/competitor-research.spec.ts`, `intelligence.spec.ts`, `grounded-search.spec.ts`, `journey.spec.ts`, `real-onboarding.spec.ts`.

Removed: `frontend/src/components/grounded-competitors.tsx`, superseded by `competitors/discover.tsx` with the same sandbox and compliance behaviour.

### Limitations

- Filters and sorting apply to the first 100 saved competitors loaded (the API page size). The UI says so when the limit is reached.
- Competitor logos are not collected, so cards show initials.
- Content Studio does not show a dedicated "using competitor insights" banner; approved insights are applied automatically to every new generation.

## Phase 7.6 onboarding integration

Real competitor intelligence is now the default in onboarding and the CRM. There is no demo activation toggle, and competitor research can be skipped. Gemini Google Search suggestions remain transient display-only results with citations, supporting links and Google Search Suggestions; they cannot be imported, persisted, crawled or supplied to content generation. Independently sourced manual/bulk competitors continue through separate website research, approval and PostgreSQL persistence. A Brave key is not required for display-only Gemini search. See [real AI onboarding](real-ai-onboarding.md) for live checks and regression evidence.

## Automated independent research — 17 November 2026 (latest)

This section supersedes the per-competitor-only research described further down. Everything below it remains accurate unless stated here.

### What changed

| Capability | Behaviour |
| --- | --- |
| Bulk add | `POST /competitors/bulk` saves up to 20 independently sourced websites at once. Each row is validated separately and reported as `created`, `existing`, `restored` or `invalid` (with a reason); one bad row never fails the batch. Duplicates within the paste and against saved records are merged by normalized domain. |
| Bulk research | `POST /competitors/research-batch` admits up to `AI_MAX_BULK_RESEARCH` (default 10) research jobs **atomically**: either all new jobs fit the hourly/queue limits or none are created (429 says how many remain). Already-active or cached research for a competitor is reused, not duplicated. |
| Parallel targeted jobs | `ai_jobs.target_key` (competitor id) replaces the old one-active-job-per-kind rule for research. Different competitors research concurrently; the same competitor can still have only one active job. All other job kinds keep `target_key=''`, i.e. the previous behaviour. |
| Progress tracking | Each competitor in `GET /competitors` carries `research_job` (latest status/stage/error) and `last_researched_at`. Stages: `queued → preparing → fetching → analyzing → assessing → completed/failed`. `GET /competitor-research-batches/{batch_id}` returns batch totals. The UI restores the last batch from the server after refresh/login. |
| Durability | Jobs are PostgreSQL rows with leases. A crashed/restarted worker's expired lease is requeued (bounded attempts, per-kind budget `AI_RESEARCH_TIMEOUT`, default 150 s) and a stale worker can never save results. Covered by `test_research_survives_worker_restart_and_completes`. |
| Richer findings | After the existing evidence-verified website extraction, a second bounded Gemini call (`competitor_analysis.py`) interprets **only verified facts**: market positioning, target audience, content themes, competitive strengths (each must cite an exact verified fact as `basis`; uncited ones are dropped), content opportunities for *your* brand, and an AI fit score. |
| Partial results | If the assessment fails (quota, timeout, invalid output) the verified website findings are still saved with `assessment_status: "unavailable"` and a warning. |
| Evidence pruning and strict revalidation | Competitor research now omits individual findings that cannot be matched to retrieved text instead of rejecting the whole response. Phase 7.6 also enables this pruning in onboarding extraction, followed by strict revalidation of every retained finding. The strict verifier still runs on what is kept. |
| Same-domain redirects | A homepage redirect within the same domain (e.g. `https://x.com → https://www.x.com/`) is followed once through the full URL/robots/DNS policy. Cross-domain redirects are refused with a message naming the target domain. |
| Relevance | `relevance_score = 0.6 × AI fit + 0.4 × term-overlap` when the assessment succeeds, otherwise term-overlap only. The reason string shows both. It is a heuristic, not a probability. |
| Edit | `PATCH /competitors/{id}` now also accepts `website_url`, `industry`, `description`, `city`, `country`. Changing the website resets verification (earlier research stays in history) and rejects duplicates (409) or your own domain (422). |
| Remove / restore | `POST /competitors/{id}/remove` and `/restore` (`{revision}`) soft-remove via `competitors.removed_at`. Nothing is deleted. Removed competitors are hidden by default (`?include_removed=true` to list), cannot be researched or edited, never feed generation and do not count toward the approval limit. Re-adding the same domain restores the record. A competitor removed mid-research is not written to. |
| Reanalyze | `POST /competitors/{id}/research` and the batch route accept `force: true` to bypass the 24-hour identical-snapshot reuse. |
| Generation input | Approved, non-removed competitors with saved research (verified **or** partially verified, since a person approved them) contribute positioning, themes, opportunities and services, plus their verification status. The content prompt instructs Gemini to use them only to differentiate and never to name competitors. Previously only `verified` counted. |
| Brave | Not required for any of the above. Brave remains optional and licence-gated for persisted automatic discovery only. |

Google grounded search is unchanged: display-only, never persisted, imported, crawled or used for generation.

### Bug fixed along the way

`html_extractor.parse_html` crashed (`AttributeError`) on pages where a hidden element contained another hidden element: decomposing the parent left the child without attributes. Such sites (e.g. atomicobject.com) previously failed with a generic worker error. Fixed with a regression test; this also benefits onboarding brand extraction.

### Database

Migration `c4e1a9b27d10` (after `ba56aacf52ad`), additive only:

- `ai_jobs.target_key VARCHAR(80) NOT NULL DEFAULT ''`, `ai_jobs.batch_id UUID NULL`.
- `uq_ai_job_active` rebuilt on `(company_id, kind, target_key) WHERE status IN ('queued','running')`; new indexes `ix_ai_job_batch`, `ix_ai_job_target`.
- `competitors.removed_at TIMESTAMPTZ NULL`.

Existing rows get `target_key=''`, which preserves their previous uniqueness exactly.

### New configuration (optional, backend `.env`, defaults shown)

`AI_RESEARCH_TIMEOUT=150` (60–240), `AI_IMAGE_TIMEOUT=120` (30–240), `AI_MAX_BULK_RESEARCH=10` (1–20). No `.env` change is required.

### Live verification (17 Nov 2026)

`python scripts/smoke_competitor_research.py --run-live --max-competitors 3` (new, opt-in) creates a retained smoke account, bulk-adds three independently chosen public software-consultancy websites through the real API, admits one batch, and runs the current research code in-process on that company's jobs only:

| Competitor | Result |
| --- | --- |
| Atomic Object | verified · relevance 72 · AI fit 85 · 2 services, 5 themes, 6 strengths, 4 opportunities, 33 evidence items |
| 8th Light | verified · relevance 47 · 4 themes, 3 strengths, 3 opportunities, 6 evidence items |
| Sparkbox | verified · relevance 28 · 2 services, 3 themes, 5 strengths, 4 opportunities, 21 evidence items |

Batch: 3/3 completed concurrently, 0 failed. Approving Atomic Object put it into the content-generation context with its opportunities. After a fresh login, all 3 competitors and 3 research records were returned. Model `gemini-2.5-flash`. Smoke company `c9186a0b-f768-4669-8458-f8ddf6cef2e0` is retained.

An earlier run of the same smoke failed all three, which led to the fixes above: thoughtbot.com returns HTTP 500 to automated clients (external, unchanged), planetary.io redirects to another domain (correctly refused, now with a clearer message), and 8thlight.com was rejected by the strict evidence validator (now handled by lenient mode). That earlier run also showed the running shared worker claiming two of the jobs; see the operational note below.

### Operational note — restart the shared worker

The shared worker process that was already running during this work (`python -m app.workers.extraction`) was started before these changes and still runs the previous research/image code. Stopping it was not permitted from this session, so it was left running. **Restart it once** (stop it, then start one instance from `backend/`) so queued research uses bulk progress stages, the assessment pass, lenient evidence, redirect handling and per-kind time budgets. The API process reloads automatically. Running two workers is safe (lease-based) but both must run the same code.

### Tests

- Backend: `tests/test_competitor_research_automation.py` (18 tests). Covers bulk add per-row outcomes, batch admission atomicity, idempotency and active-job reuse, edit/website change/duplicates, remove/restore/re-add, assessment validation and partial results, lenient pruning vs unchanged strict brand extraction, same-domain redirect policy, worker restart, removal during research, forced reanalysis, generation context and tenant isolation of every new route. Plus a parser regression test in `test_website_extraction.py`. Full suite: **251 passed**.
- Frontend unit: `tests/unit/competitor-research.test.ts` (6 tests). Full suite: **55 passed**.
- Browser: `tests/e2e/competitor-research.spec.ts` covers bulk add with an invalid duplicate, labelled research fixture rendering, editing, approval and the "Informing AI content" count, remove/restore, real batch admission with progress restored after reload, a handled fetch failure from the live worker, and 375px no-overflow. The existing `intelligence.spec.ts` and `grounded-search.spec.ts` (5 tests) still pass. Screenshots: `frontend/artifacts/competitor-intelligence-desktop.png`, `competitor-intelligence-mobile.png`.

Auto-research is opt-in for single adds and pre-selected only in bulk mode, so routine browser tests never trigger Gemini calls.

### Files

New: `backend/alembic/versions/c4e1a9b27d10_add_targeted_ai_jobs_and_competitor_removal.py`, `backend/app/services/competitor_analysis.py`, `backend/scripts/smoke_competitor_research.py`, `backend/scripts/seed_competitor_research_fixture.py`, `backend/tests/test_competitor_research_automation.py`, `frontend/tests/unit/competitor-research.test.ts`, `frontend/tests/e2e/competitor-research.spec.ts`.

Changed: `backend/app/models/intelligence.py`, `backend/app/schemas/intelligence.py`, `backend/app/api/intelligence.py`, `backend/app/services/ai_queue.py`, `backend/app/services/competitor_intelligence.py`, `backend/app/services/gemini_brand_analyzer.py` (opt-in lenient mode), `backend/app/services/website_fetcher.py` (redirect target on error), `backend/app/services/html_extractor.py` (crash fix), `backend/app/services/content_generation.py` (differentiation rule), `backend/app/workers/intelligence.py`, `backend/app/core/intelligence_config.py`, `backend/tests/test_website_extraction.py`, `frontend/src/lib/intelligence-api.ts`, `frontend/src/components/real-competitors.tsx` (rebuilt screen), `frontend/src/app/crm.css`.

### Remaining limitations

- Fully automated discovery-to-persistence still needs an appropriately licensed search provider (Brave with `AI_BRAVE_RESEARCH_LICENSE_CONFIRMED=true`). Google-grounded suggestions stay display-only by Google's terms; users copy competitor websites from independent sources.
- Some sites refuse automated access (robots, 401/403/5xx to bots, cross-domain redirects). These fail per competitor with a clear message and never block the rest of a batch.
- Research is sequential per worker process. A batch of 10 on one worker takes several minutes; the UI shows progress throughout.
- The hourly AI limit (default 12 per company) is shared by research, generation and images; large batches can use most of it.
- No social-network metrics: engagement, followers and posting frequency remain explicitly unavailable.

## Display-only Gemini search: 17 November 2026

Gemini with Google Search is now the default **display-only** discovery provider. The existing Gemini API key is sufficient; no Brave key is required. The historical Phase 5 notes below are retained as a checkpoint; the provider and display-only behavior in this section supersede their Brave-only configuration and unavailable-search statements.

### Two separate paths

| Path | Behavior | Persistence and downstream use |
| --- | --- | --- |
| Gemini Google Search | Confirmed public business context produces a live answer, source citations and Google Search Suggestions | Response only to the submitting user. No result cache, competitor import, crawler handoff, research scoring or content-generation input. |
| Independent competitor research | Independently obtained name/website, manual save, explicit secure research, Gemini analysis, explicit approval/rejection | Existing company-scoped PostgreSQL records, revision checks, source evidence and relevance scoring. Only approved AND verified research informs content generation. |
| Optional licensed Brave | Existing search adapter and persisted discovery jobs | Disabled by default; requires an appropriate subscription and explicit confirmation that storage/research use is permitted. |

Google grounding is not a replacement credential for the old search-to-database worker. There is no direct Import/Save/Research action on its answer, and no automatic use of its URLs for verification, crawling or scraping. A cited suggestion is not an independently verified competitor. The complete answer is displayed without programmatically extracting, filtering, ranking or rewriting candidate entities. The prompt requests relevant non-duplicate companies excluding the user's own company, but this is not an independently verified guarantee.

### Terms, attribution and display

The [Gemini grounding terms](https://ai.google.dev/gemini-api/terms#grounding-with-google-search) restrict collecting grounded results into databases and using their links to select crawling destinations. Consequently this implementation does not perform the originally requested grounding-to-persistence pipeline, cache these results, or send them through a second extraction request. It displays them only to the submitting user with the returned citations and Search Suggestions. Google retains grounding inputs/outputs under its stated policy; send appropriate public business information only.

See Google's [Generate Content grounding documentation](https://ai.google.dev/gemini-api/docs/generate-content/google-search) for SDK usage and metadata. These references were checked during implementation. A deployment flag does not itself obtain additional provider rights.

The UI preserves result text as text and inserts source-reference links using grounding support offsets. Google's Search Suggestions HTML/CSS is preserved in an isolated widget frame: scripts, same-origin access, forms and parent-window access are disabled. The widget remains scrollable and direct links open in another tab. Result text is outside the frame. There is no application source-click tracking or interstitial.

### Live request architecture

1. An owner/admin explicitly clicks **Discover competitors** in real competitor mode. The dashboard uses this panel; onboarding retains its existing fictional demo and **Use real competitor research** switch to the same panel. No search runs on page load.
2. New `POST /api/v1/companies/{company_id}/competitor-search` authenticates the session, checks company membership/role and requires a confirmed brand.
3. An existing `ai_jobs` row reserves operational capacity under the shared admission lock and user/company hourly limits. It stores only submitted public context, status, model and usage metadata. The transaction commits before network I/O.
4. The official Google GenAI SDK calls `generate_content` with `google_search` on **v1beta**. SDK 3.3.0 defaulted to v1, which rejected this tool in live testing; this adapter pins the compatible version without changing other Gemini clients.
5. Public context is bounded business name, industry/business type, services, audience, city/country, confirmed description as positioning, and own website for exclusion. Preferences, custom instructions, tenant IDs and unrelated history are omitted. Input and retrieved content are untrusted data, never instructions.
6. The adapter validates the response envelope, Search Suggestions, source-link syntax and support mappings. This is display validation only: no DNS lookup, redirect resolution, website extraction or claim of official-site verification. Duplicate source references collapse to one citation entry. UTF-8 source offsets convert to UTF-16 browser positions, including non-ASCII names.
7. The HTTP response carries the answer and display metadata. Job completion stores only `{provider: "gemini", display_only: true}` plus operational usage/status. It never stores answer text, source URLs, citations, web search queries or suggestion HTML.
8. The browser retains the answer only in the mounted component and clears it on dismiss/reload/unmount/company change. It never writes it to browser storage. Job history exposes operational status only; there is no grounded-result history/recovery endpoint.

Failed/interrupted live searches are never replayed by the shared worker. Expired display-only leases become failed metadata entries. Cancellation fences completion, but closing a page cannot guarantee reversing an already-sent provider request or its charge.

The existing shared extraction worker, secure website fetcher, identity/evidence checks, saved-competitor normalization/deduplication, relevance scoring, research, approvals and content/image/scheduling operations remain separate. No models or migrations change. Existing records and historical research are retained.

### Current configuration

Backend-only `.env`, relative to the backend working directory. No environment file is changed by this implementation.

| Variable | Default / purpose |
| --- | --- |
| `GEMINI_API_KEY` | Existing server key; never exposed to the frontend or logged |
| `GEMINI_MODEL` | Existing text model, currently `gemini-2.5-flash`; default search model |
| `AI_SEARCH_PROVIDER` | `gemini`; choose `brave` only for a separately authorized persistent path |
| `AI_GROUNDING_MODEL` | Optional compatible search-specific override |
| `AI_GROUNDING_TIMEOUT` | 45 seconds total, range 10-90 |
| `AI_GROUNDING_MAX_ATTEMPTS` | 1, range 1-2; only eligible 5xx/network failures retry within the total timeout |
| `AI_GROUNDING_MAX_OUTPUT_TOKENS` | 2500, range 512-4000 |
| `AI_GROUNDING_MAX_SUGGESTIONS` | Prompt requests at most 5 competitors, range 1-10; not a hard model-output guarantee |
| `AI_BRAVE_SEARCH_API_KEY` | Optional; not required for Gemini display-only search |
| `AI_BRAVE_RESEARCH_LICENSE_CONFIRMED` | False; persistent discovery stays disabled until appropriate rights exist and the operator explicitly enables this flag |
| `AI_MAX_QUERIES`, `AI_MAX_CANDIDATES` | Existing Brave bounds, not a hard cap on Google's internal search queries |
| `AI_HOURLY_COMPANY_LIMIT`, `AI_HOURLY_USER_LIMIT` | Existing shared limits: 12 / 24 AI operations per hour, including live-search metadata |
| `AI_MAX_QUEUE` | Existing global admission limit of 100 queued/running operations |

Google chooses its internal queries; this SDK's GoogleSearch tool exposes no hard query-count field. Bounds apply to API invocations, output, elapsed time and user/company usage. Quota/access/model errors do not automatically retry. There is no silent Brave or plain-model fallback when grounding evidence is missing.

Repeated live request UUIDs receive 409 to prevent double submission; results are not cached or replayed. A new live search requires an explicit new request. Existing independent research/Brave snapshot caching remains separate and never contains Gemini grounded output.

Use the existing key/model with `AI_SEARCH_PROVIDER=gemini` if an older explicit Brave setting exists. Restart the API to load settings and restart the existing shared worker to load replay guards; do not start duplicate workers. Licensing verification is an operator responsibility, not a consequence of having a Brave key.

### API additions and gates

All paths use the existing company scope, HttpOnly authentication, Origin checks and role policies. Successful grounded responses use `Cache-Control: no-store`.

| Method / path | Contract |
| --- | --- |
| GET `/ai-capabilities` | Existing image flags plus `search_provider`, `search_mode`, `search_available`, `search_state`, `brave_discovery_available`. Configured does not guarantee live access/quota. |
| POST `/competitor-search` | `{request_key: UUID}` returns `{provider: "gemini", display_only: true, text, sources: [{uri,title}], citations: [{start,end,source_indices}], search_suggestions_html}`. No saved competitor IDs. |
| POST `/competitor-discoveries` | Existing 202 job contract, now gated on configured/licensed Brave; otherwise 503 with Gemini/manual alternatives. |
| Existing jobs, competitors, research and insights endpoints | Existing status, pagination, revision, tenant and approval contracts retained. No endpoint recovers grounded result content. |

The live endpoint accepts no grounded text or import payload. Existing manual APIs cannot prove the provenance of arbitrary human-entered strings; the UI and architecture explicitly require independent sourcing rather than importing Google grounded output.

### Live verification

On 17 November 2026, one successful controlled search with `gemini-2.5-flash` and the existing key returned **7 source references, 16 support/citation mappings, a 2371-character answer and Google Search Suggestions**. Usage was 213 prompt, 567 candidate and 1852 total tokens. No answer, sources or suggestion HTML was written to a file or database, and no returned URL was fetched. This verifies access, not the identity or accuracy of individual suggestions.

Two preceding validation requests were rejected by API v1 before a grounded answer was returned. The diagnostic identified the v1beta requirement; the successful request used the corrected final adapter. No further live requests are used in automated tests.

### Verification and walkthrough

Automated tests mock Google. Coverage includes the SDK tool/API version, public context, metadata/Unicode mapping, missing/unsafe evidence, duplicate citations, retries/timeouts, quota/access errors, usage limits, replay prevention, tenant/role denial, no grounded persistence/crawling and licensed Brave gating. Existing website validation, candidate normalization/deduplication, relevance scoring, saved research/approval and content/image/scheduling tests remain enabled.

Frontend coverage includes citation mapping, preserving original text, non-cached authenticated requests, widget isolation, no import/storage, quota/manual fallback, refresh clearing, onboarding integration and company switching.

Final validation: **233 backend tests**, **49 frontend unit tests**, TypeScript, ESLint and the optimized Next.js production build passed. Alembic reported **no new upgrade operations**. After the final discovery/UI corrections, the full browser run passed 27 of 28 cases; its live shared-worker scheduling wait failed. With no AI/extraction jobs active, the existing idle worker was restarted to load the new guards, and that scheduling case passed its focused recheck in 22.9 seconds. All 28 distinct browser scenarios therefore passed across these runs; this is not a claim of one uninterrupted all-green browser run. No scheduling source was changed.

The worker now runs the updated entrypoint. Desktop and 375px mobile screenshots were visually checked: `frontend/artifacts/grounded-competitors-desktop.png` and `frontend/artifacts/grounded-competitors-mobile.png`. These artifacts contain clearly labelled mocked search fixtures, not stored live grounded output.

1. Start the existing API/frontend and one shared worker after deployment; no new migration is needed.
2. Sign in, select a company, save and confirm its public brand profile.
3. Open `/dashboard/competitors`, or **Use real competitor research** in onboarding.
4. Click **Discover competitors**. Review the answer, citations and Google Search Suggestions. There is no Import/Save/Research action on this answer.
5. Dismiss or refresh: the answer disappears without another automatic request.
6. For independently obtained competitors, use **Add competitor**, then explicitly research/approve/reject the saved record.
7. A live quota/model failure leaves independent manual entry available.

### Modified-file inventory

- `backend/app/core/intelligence_config.py`: Gemini default, bounded controls and Brave license flag.
- `backend/app/services/gemini_search.py`: SDK provider, metadata validation, safe errors, operational request journal.
- `backend/app/api/intelligence.py`: live endpoint/capabilities and persistence gate.
- `backend/app/services/ai_queue.py`: expired live searches cannot replay.
- `backend/app/services/competitor_intelligence.py`: guard persistent discovery from unlicensed/grounded providers.
- `backend/app/workers/intelligence.py`: display-only replay guard.
- `backend/tests/test_grounded_search.py`: mocked provider/API, privacy, usage and isolation tests.
- `backend/tests/test_competitor_intelligence.py`: explicitly select Brave in the existing provider-specific test.
- `frontend/src/lib/grounded-search.ts`: display-only request, response, citation and widget helpers.
- `frontend/src/components/grounded-competitors.tsx`: ephemeral grounded answer and Search Suggestions.
- `frontend/src/components/real-competitors.tsx`: provider-aware discovery and independent-sourcing labels.
- `frontend/tests/unit/grounded-search.test.ts`: request/response/citation/widget contracts.
- `frontend/tests/e2e/grounded-search.spec.ts`: dashboard/onboarding, clearing and manual fallback.
- `frontend/tests/e2e/company.spec.ts`: wait for mobile navigation to settle before its existing overflow assertion.
- `docs/competitor-intelligence.md`: current architecture, terms, configuration and validation handoff.

### Remaining limitations

- The Gemini search-to-persistence/research pipeline is intentionally disabled under the approved scope.
- Search answers disappear on refresh; history retains operational metadata only.
- Citation links can be Google redirect URLs. They are displayed as supplied and never resolved by the application.
- Exclusion/deduplication and search relevance instructions are not independent verification. Saved research retains its own scoring/evidence rules.
- A compatible model, permissions/billing and available grounding quota are still required; live success is not a future quota guarantee.
- Existing saved competitor/research UI loads the first 50 entries; API pagination remains available.

## Historical Phase 5 checkpoint (superseded provider configuration)

Implemented 2026-11-15, extending the existing authentication, company onboarding and safe website extraction. This is an implementation handoff, not a claim that all external providers are enabled. Automated search remained incomplete at that checkpoint: no search credential was configured. Manual entry, research jobs, approval and persistence were implemented.

### Historical architecture and data

The existing `python -m app.workers.extraction` process now dispatches typed jobs from `ai_jobs` as well as Phase 4 extraction jobs. One PostgreSQL lease mechanism handles discovery, research, content and image operations; there are no per-feature brokers. Claiming uses `FOR UPDATE SKIP LOCKED`, lease fencing, cumulative time budgets, bounded retries and crash reconciliation. Short transactions finish before network calls. Restart workers after deploying new handlers; web-server reload does not reload a standalone worker.

Migration `1015bf067be2` follows `4d84ba137a8a` and adds only:

| Table | Purpose and ownership |
| --- | --- |
| `ai_jobs` | Company/user, kind, request key, immutable request snapshot/result, status/stage, lease, attempts, duration, model and token usage |
| `competitors` | Editable, revisioned company references; domain uniqueness within each company; source and selection/verification states |
| `competitor_research_results` | Immutable structured research, actual source evidence, model and job; composite foreign keys prevent cross-company links |

The existing research JSON represents opportunities without a redundant insights table. All new company/user foreign keys use RESTRICT. No historical migration, account, company or Docker volume is reset. API schemas validate JSON shapes and bounds; JSONB columns do not independently implement those application-level schemas.

### Historical provider configuration

Backend only, relative to the backend working directory. `.env` is not modified by this implementation.

| Variable | Default / use |
| --- | --- |
| `AI_SEARCH_PROVIDER` | `brave`; only implemented authorized search adapter |
| `AI_BRAVE_SEARCH_API_KEY` | Absent; required for automated discovery |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Existing Phase 4 configuration, reused for website analysis |
| `AI_MAX_QUERIES` | 3, range 1–5 |
| `AI_MAX_CANDIDATES` | 10, range 1–20 |
| `AI_MAX_APPROVED_COMPETITORS` | 5, range 1–10 |
| `AI_JOB_TIMEOUT`, `AI_MAX_ATTEMPTS` | 90 seconds cumulative work, 2 attempts |
| `AI_HOURLY_COMPANY_LIMIT`, `AI_HOURLY_USER_LIMIT` | 12 and 24 shared AI jobs/hour |
| `AI_MAX_QUEUE` | 100 queued/running jobs globally |

Relevance weights are `AI_INDUSTRY_WEIGHT=25`, `AI_SERVICES_WEIGHT=30`, `AI_AUDIENCE_WEIGHT=20`, `AI_GEOGRAPHY_WEIGHT=15`, `AI_POSITIONING_WEIGHT=10`. Each component is brand-token recall: shared meaningful tokens / brand tokens. Missing data scores zero, weights normalize to 100, and the final score is rounded. This is a transparent lexical heuristic, **not a probability or calibrated business ranking**.

Brave uses its official fixed HTTPS endpoint, bounded streaming responses, no inherited proxies or redirects, and sequential requests spaced by 1.1 seconds. Search terms contain only necessary industry/services/geography; no private descriptions or custom instructions. Names never come from Gemini inventions. Normalization validates URL syntax, filters major social/directory hosts, deduplicates `www` domains and preserves distinct subdomains. Completed identical discovery/research snapshots are reused for 24 hours; changing confirmed context creates a different snapshot. Search 429 is terminal and explicit; eligible 5xx/network failures receive bounded backoff. Current plan quotas and commercial/storage rights must be reviewed for the subscribed plan.

Provider references checked during implementation: [Brave API product and signup](https://brave.com/search/api/), [official web search reference](https://api-dashboard.search.brave.com/app/documentation/web-search), [rate limiting](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting). No search-engine HTML scraping or legacy Google Custom Search dependency is introduced.

### Historical API contracts

All paths below start `/api/v1/companies/{company_id}`. Existing HttpOnly JWT, Origin policy and workspace permissions apply. Reads require membership; writes require owner/admin. Unknown and foreign-owned identifiers return 404. Responses are private/no-store. UUIDs in child queries are always scoped to company.

| Method / path | Request / response |
| --- | --- |
| GET `/ai-capabilities` | Configuration flags and explicit provider state; configured image model is not proof of access |
| GET `/ai-jobs?kind=...&limit=20&offset=0` | Job history (maximum 100 per page); never queues work |
| GET `/ai-jobs/{job_id}` | Safe status, stage, attempts and controlled error |
| POST `/ai-jobs/{job_id}/cancel` | Cancels active job, clears lease; already completed work remains retained |
| POST `/competitor-discoveries` | `{request_key: UUID}` → 202 job; unconfigured provider → 503 `search_provider_not_configured` |
| GET `/competitor-discoveries/{job_id}` | Discovery job status |
| GET `/competitors?limit=50&offset=0` | Paginated references |
| POST `/competitors` | `{name, website_url, industry?, description?}` → 201 unverified reference; repeated domain reuses record |
| GET `/competitors/{id}` | Reference, selection/verification and revision |
| PATCH `/competitors/{id}` | `{revision, name?, selection_status?}`; selection suggested/approved/rejected; stale revision → 409 |
| POST `/competitors/{id}/research` | `{request_key: UUID}` → 202 confirmed-brand research snapshot |
| GET `/competitor-insights?limit=50&offset=0` | Research, source evidence, model, strategic suggestions and unavailable metrics |

Request keys are company-scoped and body-sensitive for jobs. Active operations of the same kind reuse identical requests and reject conflicting ones. There is no automatic discovery on page load. The UI restores and polls the most recent persisted job; explicit reload recovers from network failures. Cancellation fences results but cannot undo a provider charge already incurred.

### Historical evidence, permissions and limitations

Research reuses Phase 4's single SSRF-safe fetcher, robots/restriction checks, public DNS validation, IP-pinned connections, bounded same-origin navigation and evidence validator. Retrieved text is untrusted data, never operational instructions. Gemini has no tools, secrets or access to unrelated tenants in its prompt. Provider exception strings are not sent to the browser.

Identity is verified only when retrieved explicit company-name evidence has the same informative name terms as the candidate after common legal suffixes are removed; ambiguous results are partially verified. This is an MVP identity check, not legal entity verification. Approval does not assert identity. Research never overwrites manually edited names/descriptions or user selection. Automatic batch candidate verification is not implemented: users explicitly research candidates, limiting costs.

Insights distinguish retrieved offerings from strategic suggestions. No social network competitor API is connected. Engagement, followers and posting frequency remain null; no inferred campaign performance, fabricated gaps or copied posts. Only approved **and verified** competitors contribute a bounded services/opportunities context to generation. Content works with no competitors.

Dashboard competitor cards/details now use real APIs; onboarding retains its explicitly fictional demo option and offers real mode. Demo acknowledgement in legacy onboarding remains separate from real approval. The current UI loads the first 50 competitors/research entries; API pagination supports larger sets. Name edits save on blur in the details dialog. Rejected records remain retained and can be reapproved.

### Historical verification and manual demo

Phase 5 checkpoint: 8 targeted backend tests passed before Phase 6 integration. Coverage includes query privacy, malformed/duplicate candidates, scoring, provider unavailable/429/503, manual persistence, approval/rejection, stale revisions, real foreign-user denial, mocked evidence-preserving research, idempotency and lease recovery. Phase 4 evidence/SSRF tests remain part of the full suite. Final integrated results are recorded in `ai-content-generation.md`.

1. Run migrations from backend: `.venv\Scripts\python -m alembic upgrade head`; start API and `.venv\Scripts\python -m app.workers.extraction` separately.
2. Sign in, select a company, save and confirm the brand profile.
3. Open Competitor Intelligence. Without a search key, confirm the unavailable notice; add a real public business website manually.
4. Open Details, choose Research website. This uses Gemini quota and permitted public website fetching. Review sources and verification status; approve or reject explicitly.
5. Refresh or log out/in and confirm selection and evidence persist. Another tenant must receive 404 for the same IDs.
6. To enable discovery, configure the authorized Brave subscription/key server-side and restart API/worker. Bound the test to the configured query count; search live access is not verified here.

No live search or competitor research smoke was run in this phase. Routine tests mock providers and never spend quota. Phase 4's historical live extraction is not claimed as a new Phase 5 live research result.
