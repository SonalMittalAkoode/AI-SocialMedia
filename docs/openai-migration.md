# SocialAI: migration from Gemini to OpenAI

**Status:** OpenAI is the active provider for every AI workflow. Mocked automated tests and a bounded live run against the real API and worker both pass. Date: 2026-11-20.
**Scope:** AI provider only. The UI layout and the Bordeaux, Deep Green and Cream theme are unchanged. CRM, onboarding, competitor management, approvals, scheduling, LinkedIn OAuth and every database record are also unchanged.

## 1. Summary

- `AI_PROVIDER` selects one provider for all workflows. It defaults to `openai`.
- When OpenAI is selected, no Gemini client is created and no Gemini request is made. Automated tests fail if a Gemini client is constructed.
- There is no silent fallback. If OpenAI fails or is not configured, the job fails with an explicit error.
- Gemini remains available as an explicitly selectable, inactive provider (`AI_PROVIDER=gemini`). Its code path is unchanged.
- The official OpenAI Python SDK is used (`openai==3.57.0`):
  - the **Responses API** with **Structured Outputs** for text and research;
  - the Responses API **`web_search` tool** for competitor discovery;
  - the **Images API** (`/images/generations` and `/images/edits`) for images.
- All six workflows were verified live. The run cost about **$0.20** at OpenAI's published rates (section 9).

## 2. Gemini integration audit (before)

| Workflow | Module | Gemini call |
|---|---|---|
| Website understanding: business description, industry, location, products/services, audience, brand voice, keywords, colours, contact details | `services/gemini_brand_analyzer.py` (worker job) | `generate_content` with JSON schema. Server-assigned passage IDs are checked against retrieved text. |
| Competitor website research | `competitor_intelligence.research` → the same analyzer (lenient mode) | Same as above |
| Competitive assessment (positioning, strengths, opportunities, fit) | `services/competitor_analysis.assess` | `generate_content` with JSON schema |
| Competitor discovery (search suggestions) | `services/gemini_search.py`, `POST /competitor-search` | Google Search grounding, display-only |
| Captions, hooks, hashtags, CTAs, titles, image briefs | `services/content_generation.generate` | `generate_content` with JSON schema, plus quality pipeline v2.x |
| Image generation and reference edits | `services/media_storage.GoogleImageProvider` | Native image model via `generate_content` |
| Optional image review | `services/image_quality.ai_review` | Multimodal `generate_content` |
| Worker wiring and model labels | `workers/extraction.py`, `workers/intelligence.py`, `content_handlers.py` | `GeminiBrandAnalyzer()`; `GEMINI_MODEL` and `AI_GEMINI_IMAGE_MODEL` written to job records |
| Capabilities | `api/intelligence.py`, `api/content.py`, `post_media.py` | Read `gemini_image_model` directly |
| Manual scripts | `scripts/quality_benchmark.py`, `smoke_content.py`, `smoke_image_generation.py`, `smoke_competitor_research.py`, `smoke_image_quality.py` | Call Gemini directly (opt-in tools; see section 10) |

Website fetching, URL safety, evidence verification, schemas, editable fields and approval flows are provider-neutral. They were reused unchanged.

## 3. Model verification

**Live check.** `GET /v1/models` with the project key is a read-only call at no cost. It returned 99 models, including all four configured IDs:

| Setting | Model ID | Listed for this project | Documented capability (developers.openai.com/api/docs/models) |
|---|---|---|---|
| `OPENAI_TEXT_MODEL` | `gpt-6-luna` | ✅ | Responses API and Chat Completions; Structured Outputs; `web_search`; image input; reasoning effort none–max; $0.10 / $0.50 per 1M input/output tokens |
| `OPENAI_RESEARCH_MODEL` | `gpt-6.2-sol` | ✅ | Responses API; Structured Outputs; `web_search`; image input; reasoning effort `none` is rejected (low–max); $2 / $10 per 1M input/output tokens |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.6-flare` | ✅ | `/images/generations` and `/images/edits` only (not the Responses API); "for fast iteration"; image output $30 per 1M tokens |
| `OPENAI_PREMIUM_IMAGE_MODEL` | `gpt-image-2.6-sunburst` | ✅ | Same endpoints and pricing; "for detailed compositions and image editing" |

**Does `gpt-image-2.6-flare` / `gpt-image-2.6-sunburst` exist?** Yes. Both are listed for this API project, documented on their model pages, and produced images in the live run. No alternative such as the GPT Image 2.5 family was needed. No model name was changed.

**Endpoint compatibility decisions:**
- Text and research use `client.responses.create` with `text.format = json_schema`, `strict: true` and `store: false`.
- `temperature` is not sent. The model pages do not document it for these reasoning models, so creativity is controlled through the prompt and reasoning effort (`low` by default).
- Images use `client.images.generate` / `client.images.edit` with exact `WIDTHxHEIGHT` sizes. The docs require both edges to be multiples of 16, an aspect ratio between 1:3 and 3:1, and 655,360–8,294,400 pixels.
- Each image response's `x-request-id` header is saved as the provider request ID. The Images API returns no response body ID.

## 4. OpenAI provider implementation

| Module | Responsibility |
|---|---|
| `app/services/ai_provider.py` | Selects the provider, chooses models per workflow, and creates the analyzer, image provider and search provider |
| `app/services/openai_provider.py` | `OpenAIGateway`: bounded calls, error mapping, strict schema conversion, usage capture, refusal and incomplete-output handling |
| `app/services/openai_brand.py` | `OpenAIBrandAnalyzer` subclasses the existing analyzer. It reuses the same system rules, passage IDs, citation attachment, strict/lenient verification and contact/colour/social merging. Only the model call differs. |
| `app/services/openai_search.py` | Display-only `web_search` discovery. `url_citation` annotations become numbered, clickable citation markers. |
| `app/services/openai_images.py` | Images API generation and reference edits with exact sizes, PNG validation and request IDs |

**Model per workflow:**
- `gpt-6.2-sol` (research model): website analysis, competitor research, competitive assessment and web search.
- `gpt-6-luna` (text model): captions and optional image review.
- `gpt-image-2.6-flare`: fresh images.
- `gpt-image-2.6-sunburst`: reference edits (the documented use for that model). If `OPENAI_PREMIUM_IMAGE_MODEL` is empty, edits use the standard image model.

**Structured outputs.** Pydantic schemas are converted to strict form:
- every object gets `additionalProperties: false` and lists every property as required;
- enum-keyed maps such as `social_links` become fixed nullable keys;
- unsupported bounds are removed from the wire schema and restated as descriptions, for example "At most 1600 characters.".

Pydantic still validates the full contract locally, including every length bound. Validation behaviour (factual checks, claim rules, competitor-overlap rules, line breaks and brand relevance) is the same as on the Gemini path.

**Images.** Every SocialAI ratio maps to an exact size, so nothing is stretched or cropped:

| Ratio | Size |
|---|---|
| 1:1 | 1024×1024 |
| 4:5 | 1024×1280 |
| 3:4 | 960×1280 |
| 4:3 | 1280×960 |
| 16:9 | 1536×864 |
| 9:16 | 864×1536 |
| 3:2 | 1536×1024 |
| 2:3 | 1024×1536 |

- The existing quality checks still run on the returned image: decode, resolution, ratio, blank, palette and duplicate detection.
- An edit sends the stored earlier image as the reference. Generation mode `edit` means the image was generated from that reference. The original asset and file are never modified.
- In the live test the edit kept the composition and changed only the background. The UI still makes no claim of pixel-precise editing.

**Competitor search.** It stays display-only, exactly like the Gemini version:
- the answer, sources and citations exist only in the HTTP response;
- the `AIJob` journal stores `{"provider": "openai", "display_only": true}` plus usage;
- nothing is imported into the competitor database.

OpenAI's guide requires "inline citations as prominent, clickable links", so each cited span is rendered as a numbered source link. OpenAI's Service Terms page could not be read (HTTP 403), so persisting search-derived data was **not** enabled. Previously Google-grounded results were never stored, so none could be imported. Independent competitor URLs, persisted research and approved insights keep their separate flows.

## 5. Errors, retries, usage and budget

| Condition | Code | Retried? |
|---|---|---|
| Invalid key (401) | `openai_auth_failed` | No |
| No access, organization verification or region (403) | `openai_access_denied` | No |
| Model not available (404) | `openai_model_unavailable` | No |
| Request rate limit (429 `rate_limit_exceeded`) | `openai_rate_limited` | Yes, bounded; honours `Retry-After` up to 20 s |
| Credit, quota or spend limit (429 `insufficient_quota`, `credit_balance_exhausted`, `*_spend_limit_exceeded`, …) | `openai_billing_limit` (images: `image_quota`) | **Never** |
| Moderation (`moderation_blocked`) | `openai_content_blocked` | No |
| Unsupported option, tool or schema (400/422) | `openai_request_rejected` (search: `search_model_unsupported`; edit: `image_edit_rejected`) | No |
| Timeout, connection error, 5xx | `openai_timeout` / `openai_unavailable` | Yes, bounded |
| Refusal | `openai_refused` | No |
| Incomplete or empty output | Validation failure, then one correction pass | One correction pass |

**Retry policy.**
- The SDK's own retries are disabled (`max_retries=0`).
- Total attempts are capped by `AI_OPENAI_MAX_ATTEMPTS`, default 2.
- Exponential backoff with jitter.
- Job-level timeouts still apply.

**Error messages are fixed text.** Provider error bodies, model output and keys are never shown or logged.

**Usage.**
- The exact `usage` returned by the API is stored in `token_usage` for jobs and research results: input, cached, output, reasoning and image tokens, plus web search call counts.
- Failed caption jobs now keep the usage the provider reported.
- No cost is estimated in the product.

**Budget safeguards.** Application caps over a rolling 24 hours, in addition to the existing hourly caps:
- `AI_DAILY_COMPANY_LIMIT`: 80 operations per company;
- `AI_DAILY_IMAGE_LIMIT`: 30 images per company;
- `AI_DAILY_GLOBAL_LIMIT`: 400 operations across the installation.

These are application limits only. OpenAI budget alerts are not hard spending limits, so also set a project spend limit in the OpenAI dashboard.

## 6. Environment configuration

`backend/.env` was **not modified**. The user had already added the OpenAI key and the four model IDs. Values are never printed.

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `openai` | `openai` or `gemini`. **Recommended:** add `AI_PROVIDER=openai` to `.env` explicitly. |
| `OPENAI_API_KEY` | none | Server-side only (`SecretStr`); never logged or returned |
| `OPENAI_TEXT_MODEL` / `OPENAI_RESEARCH_MODEL` | none | `gpt-6-luna` / `gpt-6.2-sol` |
| `OPENAI_IMAGE_MODEL` / `OPENAI_PREMIUM_IMAGE_MODEL` | none | `gpt-image-2.6-flare` / `gpt-image-2.6-sunburst` |
| `OPENAI_WEB_SEARCH_ENABLED` | `false` | `true` in `.env` |
| `AI_OPENAI_TIMEOUT`, `AI_OPENAI_MAX_ATTEMPTS` | 60 s, 2 | Gateway bounds |
| `AI_OPENAI_TEXT_REASONING`, `AI_OPENAI_RESEARCH_REASONING` | `low`, `low` | `gpt-6.2-sol` rejects `none` |
| `AI_OPENAI_TEXT_TIMEOUT`, `AI_OPENAI_TEXT_MAX_OUTPUT_TOKENS` | 45 s, 12000 | Captions and assessment (reasoning tokens count toward output) |
| `AI_OPENAI_ANALYSIS_TIMEOUT`, `AI_OPENAI_ANALYSIS_MAX_OUTPUT_TOKENS` | 45 s, 16000 | Website analysis |
| `AI_OPENAI_IMAGE_QUALITY` | `medium` | `low`, `medium`, `high` or `auto` |
| `AI_DAILY_COMPANY_LIMIT`, `AI_DAILY_IMAGE_LIMIT`, `AI_DAILY_GLOBAL_LIMIT` | 80, 30, 400 | Application caps |
| `GEMINI_API_KEY` | `""` | Now optional; only needed with `AI_PROVIDER=gemini` |

## 7. Modified files

**Backend, new:**
- `app/services/ai_provider.py`
- `app/services/openai_provider.py`
- `app/services/openai_brand.py`
- `app/services/openai_search.py`
- `app/services/openai_images.py`
- `scripts/smoke_openai_live.py`
- `tests/test_openai_provider.py`

**Backend, changed:**
- `app/core/config.py`: provider and OpenAI settings; Gemini key optional.
- `app/core/intelligence_config.py`: OpenAI bounds and daily caps.
- `app/services/ai_queue.py`: daily caps; failed jobs keep reported usage.
- `app/services/gemini_brand_analyzer.py`: provider call split from the shared evidence pipeline; Gemini behaviour identical.
- `app/services/competitor_analysis.py`, `competitor_intelligence.py`, `content_generation.py`, `image_quality.py`: OpenAI call path next to the unchanged Gemini path; field-level correction hints.
- `app/services/content_handlers.py`: provider factory; the model that actually produced each image is recorded.
- `app/services/gemini_search.py`: provider-aware journal metadata.
- `app/services/post_media.py`, `app/api/content.py`, `app/api/intelligence.py`: provider-neutral availability; capabilities report `ai_provider` and `ai_provider_label`.
- `app/workers/extraction.py`, `app/workers/intelligence.py`: the shared worker uses the same provider factory; model names are logged, keys never.
- `requirements.txt`: `openai==3.57.0`.
- `pytest.ini`: `openai_provider` marker.
- `tests/conftest.py`: existing suites, which use Gemini-shaped fakes, pin `AI_PROVIDER=gemini`.
- `tests/test_scheduling_worker.py`: patches the provider factory instead of the old class name.

**Frontend:**
- `src/lib/grounded-search.ts`: accepts `provider: "openai"`; Google Search Suggestions are required only for Gemini answers.
- `src/components/competitors/discover.tsx`: attribution follows the answer's provider ("OpenAI web search results" / "Searched with OpenAI web search"); the Google suggestions frame appears only for Gemini answers.
- `src/components/content/real-content.tsx`: the Studio badge and notice show `ai_provider_label` from the server.
- `brand-extraction.tsx`, `onboarding.tsx`, `competitors/dialogs.tsx`, `competitors/shared.tsx`: "Gemini" wording replaced with accurate provider-neutral wording.
- Tests: `tests/e2e/grounded-search.spec.ts` (new OpenAI test), `extraction.spec.ts` and `competitor-research.spec.ts` (updated labels), `tests/unit/grounded-search.test.ts` (3 new tests).

No layout, theme, route or component structure changed.

## 8. API and database changes

- **Database:** none. No migration was added or edited (Alembic head `09efca8855d4`, `alembic check` clean). Existing columns record the provider's model: `model_identifier`, `generation_model`, `provider_request_id`, `token_usage`.
- **API shapes:**
  - `/ai-capabilities` gained `ai_provider`, `ai_provider_label` and `text_available`. `search_provider` now reports the active provider.
  - `/competitor-search` keeps its shape: `provider` is `"openai"` and `search_suggestions_html` is `""`.
  - Content results gain `generation_meta.provider` on the OpenAI path.
  - New error codes are listed in section 5.
- **Historical data:**
  - Gemini-era records keep their original `model_identifier` / `generation_model` values (for example `gemini-3.1-flash-image`) and media files.
  - Historical jobs are not re-run.
  - Saved content is never replaced with demo content after a failure.

## 9. Tests

| Suite | Baseline (before) | After |
|---|---|---|
| Backend (pytest) | 353 passed | **399 passed** (353 + 46 new OpenAI tests) |
| Frontend unit (vitest) | 84 passed | 87 passed |
| Browser (Playwright, SocialAI dev server on :3001, live API and worker on OpenAI) | 46 passed | **47 passed in one run** (8.9 min; 1 new OpenAI search test) |
| TypeScript, ESLint, production build | pass | pass |
| Alembic | head `09efca8855d4` | head `09efca8855d4`, `check` clean |

**The 46 new mocked OpenAI tests** in `tests/test_openai_provider.py` spend no credits. They cover:
- strict schema conversion, including the regression where a field named `title` was dropped;
- error mapping, and that billing errors are not retried while transient errors are retried within the bound;
- refusals and incomplete output;
- that no Gemini client is created when OpenAI is selected;
- missing-key behaviour;
- brand extraction with evidence verification and rejection of invented evidence;
- caption generation and field-level correction;
- web search citations and display-only behaviour;
- exact sizes for every ratio, edits to `/images/edits` with the premium model, and error mapping;
- end to end through the API, worker handlers and PostgreSQL: a text job, image generation and edit, failed text and image calls saving nothing, capabilities, and search importing nothing.

### Bounded live run (approved: 2026-11-20)

All runs used a new smoke account and company, so no real brand record was modified. Script: `scripts/smoke_openai_live.py`.

| Workflow | Model | Result | Usage (tokens) |
|---|---|---|---|
| 1. Company research (akoode.com) | gpt-6.2-sol | ✅ Akoode Technologies, "AI and software development", Gurugram, IN, 4 services, 3 voice traits, 31 evidence items (explicit, inferred, suggested) | 4,562 in / 1,469 out |
| 2. Competitor research (thoughtworks.com) | gpt-6.2-sol | ✅ Verified identity; assessment completed (fit 45/100 with a sensible rationale); 31 evidence items | 6,315 in / 1,856 out (analysis + assessment) |
| 3. Web search discovery | gpt-6.2-sol + `web_search` | ✅ 3 cited sources (uptech, netguru, thoughtbot), 3 clickable citations, 14 s. **0 competitor rows created.** | 12,844 in / 397 out; 2 search calls |
| 4. Captions (LinkedIn, educational) | gpt-6-luna | ✅ Hook alone on line 1; all 6 quality checks pass; first attempt; 5.9 s | 1,933 in / 325 out |
| 5a. Image generation (4:5) | gpt-image-2.6-flare | ✅ 1024×1280 exactly; Ready for review; all checks pass; 8.8 s | 686 in / 1,248 image out |
| 5b. Image edit (light background) | gpt-image-2.6-sunburst | ✅ Parent linked; composition preserved; original kept; Ready for review; 21.8 s | 2,042 in (1,280 image) / 1,248 out |
| 6. Save and retrieve post | n/a | ✅ Caption matches; primary image attached. Editing the approved post's image returned it to **draft** (approval invalidation works). | n/a |

**First two caption attempts failed.** The live run found a converter bug: a schema field named `title` was stripped with JSON-schema `title` metadata. The model followed the incomplete schema, and local validation correctly rejected the draft, so nothing was saved. I fixed the bug, added a regression test and re-ran only the caption and image steps.

**Request count and cost.** The run made 13 OpenAI requests in total, one more than the "about 12" quoted for approval. The extras were caption attempts and one diagnostic call, each about $0.001.

Cost from published per-token prices:

| Item | Approx. cost |
|---|---|
| Research | $0.10 |
| Captions | $0.002 |
| Images | $0.09 |
| **Total** | **≈ $0.20** |

This is an estimate, not a billed amount; the OpenAI dashboard is authoritative. The first failed caption attempt has no recorded usage because it ran before the usage-on-failure fix.

Artifacts are in `frontend/artifacts/openai-migration/`: `openai-fresh-4x5.png`, `openai-edit-4x5.png`, `web-search-answer.md` and `live-report.json`.

### Data and credential preservation

I took a snapshot before the final regression run and compared it after the full browser suite:

| Check | Result |
|---|---|
| 26 Gemini-generated assets (IDs, storage keys, `generation_model`) | Unchanged |
| Their 26 media files on disk | All present |
| 86 Gemini job records | Unchanged |
| 4 Gemini competitor research records | Unchanged |
| 14 Gemini brand extractions | Unchanged |
| Brand colours of 1,080 pre-existing brand profiles | Unchanged |
| 923 pre-existing workspace roles (tenant permissions) | Unchanged |
| Statuses of 155 pre-existing schedules | Unchanged |

New rows come only from the test suites and the smoke run.

On credentials:
- `backend/.env` and `.env` were never written by this work, and both are gitignored.
- Worker logs contain model names only, with no key patterns.
- The API key never leaves the server.

## 10. Remaining limitations

- **Search-result persistence:** not enabled. OpenAI's Service Terms page returned 403, so its rules for storing search output could not be reviewed. Discovery stays display-only, which matches the previous behaviour. Review the terms before enabling persistence.
- **Image provenance metadata:** the OpenAI docs read for this work do not mention C2PA or other provenance metadata. SocialAI's existing validation re-encodes every image as a clean PNG, which strips embedded metadata (the same as before).
- **Optional AI image review** (`AI_IMAGE_REVIEW`, default off): the OpenAI path is covered by mocked tests only and was not run live.
- **Manual Gemini scripts:** `quality_benchmark.py`, `smoke_content.py`, `smoke_image_generation.py` and `smoke_competitor_research.py` still call Gemini directly. They are opt-in tools, not application paths, and are not used when `AI_PROVIDER=openai`. Use `smoke_openai_live.py` for OpenAI.
- **Usage on failure:** recorded for caption generation. Some other failure paths (brand-analysis validation failures, assessment failures) still drop usage, the same as on the Gemini path.
- **Edits are not pixel edits:** OpenAI edits re-render the image guided by the reference. The live edit preserved the composition closely, but this is not guaranteed.
- **Organization verification:** the image docs say GPT Image models may require it. It worked for this project.
- **Search URLs:** may include `utm_source=openai` as returned by OpenAI. They are shown as supplied and never fetched.

## 11. Worker restart procedure

The FastAPI server (`uvicorn --reload`) picks up code changes automatically. **`.env` changes and the shared worker need a manual restart:**

```powershell
# from backend/
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'app.workers.extraction' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
.venv\Scripts\python.exe -m app.workers.extraction
```

At startup the worker logs `AI provider=openai text_model=… research_model=… image_model=…` (model names only). Leased jobs interrupted by a restart are reclaimed under the existing lease and attempt rules.

The worker was restarted three times during this work:
1. to load the OpenAI provider;
2. to load the field-level correction and usage-on-failure changes;
3. to load the schema-name fix.

No jobs were in flight at the first restart.

## 12. Rollback plan

1. Set `AI_PROVIDER=gemini` in `backend/.env`, restart the API and the worker. Gemini handles every workflow again through its unchanged code path. No data migration is needed.
2. To remove the code entirely, revert the files listed in section 7. No database changes are involved.
3. Records and images created with OpenAI keep their `gpt-*` model identifiers and remain viewable and editable under either provider.
