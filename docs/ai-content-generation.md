# AI content and persistent drafts

> Phase 8A.1 (19 November 2026) replaced the image brief, caption strategy and Studio controls and added image quality checks, variations and review. See [ai-content-quality-optimization.md](ai-content-quality-optimization.md); where the two documents differ, that one is current.

## End-to-end text and image generation — 17 November 2026 (latest)

This section supersedes the Phase 6 statements below that live image generation is unconfigured/unverified and that images are square or 16:9 only. Everything else in the Phase 6 handoff still applies.

### What users can do now

| Capability | How it works |
| --- | --- |
| Text with images | Content Studio (and onboarding's real mode, which reuses it) has **Generate images with posts** plus an aspect-ratio choice. `POST /content-generations` accepts `include_images` and `aspect_ratios`. The text job completes first. In the same transaction the worker queues one image job per result, so text is never delayed or blocked by images. |
| Text only | Untick the option, or no image model configured: drafts are text-only with a clear note. |
| Brand-specific creatives | `post_media.image_brief` builds the image brief from the confirmed brand: industry, offerings, audience, voice and keywords, **exact saved brand colours**, the post's topic, hook and visual concept, platform and ratio, excluded topics, and approved competitor themes to avoid imitating. Logos, brand names, identifiable people, testimonials, fake product shots, numbers/claims and rendered text are excluded. |
| Platform sizes | Defaults: Instagram 4:5, Facebook 1:1, LinkedIn 1:1, X 16:9. Any of `1:1, 4:5, 3:4, 4:3, 16:9, 9:16, 3:2, 2:3` can be chosen per image. |
| Independent caption regeneration | `POST /posts/{id}/regenerate` with `{"mode":"caption"}` asks for a new caption, hook, CTA and hashtags for the same post and visual. The editor shows it as a suggestion; **Apply caption to editor** only fills the fields, and saving is the usual revision-checked edit. Images are untouched. `mode:"full"` keeps the previous "fresh alternative" behaviour. |
| Independent image regeneration | `POST /posts/{id}/images` (`aspect_ratio`, optional `instructions`) or `POST /content-generations/{job}/results/{i}/images` for unsaved results. Every image is kept, and the newest becomes the post's image. |
| Manual upload | `POST /posts/{id}/assets/upload?revision=N&filename=...` with a raw PNG, JPEG or WEBP body (≤ `AI_MAX_IMAGE_BYTES`, default 8 MB). Files are validated (format matches the declared type, single frame, 64–4096 px, ≤16 MP), metadata-stripped, re-encoded to PNG and stored privately. Filenames are reduced to a safe basename. |
| Choose the image | `PUT /posts/{id}/primary-asset {revision, asset_id|null}` selects any of the post's images or makes it text-only. Nothing is deleted. |
| Preview / download | `GET /media/{asset_id}` serves inline; `?download=true` sends `Content-Disposition: attachment`. Both require company membership and are `private, no-store`. |
| Duplicate | `POST /posts/{id}/duplicate` now also copies the post's chosen image as an independent `duplicated` asset. The original post and its media are untouched. |
| Version history | Every change to a post's content, status or chosen image stores the previous state in `post_versions`, written by a database trigger and append-only. `GET /posts/{id}/versions`; the editor can load earlier text back for review and saving. |

### Revision protection for images

Changing which image a post uses (generate, upload, select, or make text-only) is a content change:

- The post revision increments, so the existing `block_schedules_on_post_change` trigger blocks any active schedule.
- An **approved** post returns to **draft** and must be approved again. The editor warns and asks for confirmation first.
- If the post is edited while an image is generating, the finished image is kept as an **alternative** (`primary: false`) instead of replacing the chosen one. A paid image is never discarded, and the edit is never overwritten.
- Archived posts reject image changes until restored.

### Failure, quota and limits

- Image failures (quota `image_quota`, access/model `image_provider_unavailable`, timeout, invalid file) fail only that image job, with a message in the UI. The text result and saved posts are unaffected. 5xx/timeouts retry within the worker's attempt budget; quota errors do not.
- A text-with-image request reserves capacity for its image jobs at admission (`extra_capacity`), so it is either fully admitted or rejected with 429. It cannot start and then be unable to queue its images.
- Images use their own Gemini client with an `AI_IMAGE_TIMEOUT` budget (default 120 s), independent of the shared 35 s text client.
- At most 20 images per post; duplicate the post to keep experimenting.
- The hourly AI limit is shared: each image counts as one operation.

### Bugs found by the live checks and fixed

1. **Brand colours caused generation to fail.** The existing "unsupported numeric claim" rule also scanned the visual concept, and Gemini correctly writes the brand's hex colours there (e.g. `#3b2417`). Any brand with saved colours could see `content_validation_failed`. The rule now applies only to published copy (title, caption, hook, CTA, slide text). Links and promotional-wording checks still cover all fields. Regression test added.
2. **Upload preflight.** A custom filename header was blocked by the API's CORS policy; the filename is now a bounded query parameter, so CORS is unchanged.

### Database

Migration `e8f3c2a61b45` (after `c4e1a9b27d10`), additive only:

- `post_assets`: `job_id` and `post_id` become nullable; new `source` (`generated|uploaded|duplicated`, default `generated`), `generation_job_id`, `result_index`, `original_filename`, `aspect_ratio`, `created_by`. Checks: only `generated` assets have an image job; every asset belongs to a post or to a specific unsaved result. Composite FK keeps result assets in the same company as their generation job.
- `posts.primary_asset_id`, with a composite FK to `post_assets(id, post_id)` so a post can only use its own image.
- `post_versions` table, `socialai_snapshot_post` trigger (AFTER UPDATE on posts, only when content, status or chosen image change) and an append-only guard trigger.

Existing assets are provider output attached to posts and satisfy every new constraint unchanged.

### Live verification (17 Nov 2026)

`python scripts/smoke_image_generation.py --run-live --max-images 3` (new, opt-in) through the real API, with this company's jobs run in-process by the current code:

- Text: `gemini-2.5-flash` produced Instagram and LinkedIn drafts with captions, 3 hashtags each and CTAs for "Brew & Bean Roasters".
- Images: `gemini-3.1-flash-image` produced a LinkedIn 1:1 creative (1024×1024, 9.7 s) and, on the follow-up run, an Instagram 4:5 creative (928×1152, 11.4 s) plus a regenerated 4:5 variant (11.1 s). All three use the saved palette (#3b2417, #d4a373, #f5ebe0), are coffee/origin themed and contain no text, logos or people. They were inspected visually.
- Saving result 0 attached its image to the new post. The regeneration kept the earlier image and made the new one primary. Images downloaded through the authenticated media route, and assets were present after a fresh login.
- The smoke's Instagram image job on the first run was claimed by the **old shared worker** (see below) and failed in 161 ms because that code predates result-image jobs. The 4:5 result was then re-run successfully. Smoke company `947010f8-0616-4667-8662-6b7c6171fd6c` is retained.

### Restart the shared worker

As with competitor research, the already-running `python -m app.workers.extraction` process predates this work and must be restarted once. Until then, image jobs it claims for unsaved results fail with `worker_failure`, and post-image jobs run the old prompt and square/16:9 limits. Text generation is unaffected.

### Tests

- Backend `tests/test_post_media.py` (16 tests): text-with-image queueing and linking on save; image failure isolating text; capacity reservation; text-only fallback; approved+scheduled post → draft + schedule blocked; edit during generation → alternative; regeneration keeps history; primary selection with stale revision, foreign asset and clear; upload type, size and content validation, WEBP→PNG, filename sanitising, download disposition, tenant isolation; archived rejection; duplicate copies the image; caption mode; append-only versions; brand brief; provider quota/5xx/ratio errors; hex-colour regression. Full suite **267 passed**.
- Frontend unit `tests/unit/post-media.test.ts` (5 tests); full suite **60 passed**.
- Browser `tests/e2e/content-media.spec.ts` (2 tests) against the real API and database. Upload with preview and download, invalid-file rejection, approval then confirmed image change returning to draft, switching images, caption regeneration applied and saved (provider mocked), version history, persistence after reload, mobile layout. Studio sends `include_images` and `aspect_ratios` and renders the result image (provider mocked). Screenshots: `frontend/artifacts/post-media-desktop.png`, `post-media-mobile.png`, `studio-image-desktop.png`.

### Files

New: `backend/alembic/versions/e8f3c2a61b45_add_post_media_uploads_primary_image_and_versions.py`, `backend/app/services/post_media.py`, `backend/scripts/smoke_image_generation.py`, `backend/tests/test_post_media.py`, `frontend/src/components/content/post-media.tsx`, `frontend/src/components/content/post-revisions.tsx`, `frontend/src/store/use-job-watch.ts`, `frontend/tests/unit/post-media.test.ts`, `frontend/tests/e2e/content-media.spec.ts`.

Changed: `backend/app/models/content.py`, `backend/app/schemas/content.py`, `backend/app/api/content.py`, `backend/app/services/content_handlers.py`, `backend/app/services/media_storage.py`, `backend/app/services/content_generation.py`, `backend/app/services/ai_queue.py` (`extra_capacity`), `frontend/src/lib/content-api.ts`, `frontend/src/components/content/real-content.tsx` (Studio image options and result image; saved editor uses the new panels), `frontend/src/components/onboarding.tsx` (help text accuracy), `frontend/src/app/crm.css`.

### Remaining limitations

- Local private storage (`AI_MEDIA_ROOT`) is still development storage, not object storage. API and worker must share the volume.
- Carousels and memes are still concepts: one image per post, not rendered multi-slide sets.
- Version history covers changes from this release onward; earlier edits were not recorded.
- No publishing: platform media upload, social OAuth and delivery remain Phase 8.

## Phase 6 handoff (historical)

Implemented 2026-11-15. Real Gemini text generation and PostgreSQL drafts are connected to the existing dashboard. **Live image generation remains incomplete/unverified** because no image model is configured. The adapter and private storage integration are tested with mock image bytes, not claimed as proof of paid image access. Automated competitor discovery is also unavailable without its separate search key.

## Architecture

Content requests require the selected company's confirmed brand. A durable `ai_jobs` request snapshots brand/company revisions, preferences and optional approved, verified competitor services/opportunities. No competitor captions or imagery are copied. Strategy is deterministic: goal, audience, offering-based pillars, requested topic/type/platforms, saved language/tone, conceptual creative direction and CTA. Gemini writes structured platform variations using these constraints, with no browsing or tools. Missing competitor insights do not block generation.

The existing extraction worker dispatches the job. Short DB transactions surround external calls; lease fencing prevents cancelled/stale workers saving results. Raw results stay in `ai_jobs.result`; users explicitly save editable posts. Regeneration creates a separate job/result and never writes over the original draft. Editing approved content requires a new draft/review state; approval is a separate revision-checked action. No publishing or scheduling states are introduced for real posts.

## Database and API contracts

Migration `42e2d03f6e9d` follows Phase 5 `1015bf067be2`, adding `posts` and `post_assets`. Both are company-owned; composite foreign keys bind generation jobs and assets to the same tenant. Posts have optimistic revisions, creation-key uniqueness and `(company_id, generation_job_id, result_index)` uniqueness. Assets store UUID metadata and private storage references, never binary DB blobs. RESTRICT preserves provenance and avoids cascading data loss. Application schemas bound JSONB fields; DB constraints enforce platform/status/MIME/dimensions/relationships.

All endpoints start `/api/v1/companies/{company_id}` and reuse existing authentication, membership reads, owner/admin writes, Origin checking and no-store policy.

| Method / path | Contract |
| --- | --- |
| POST `/content-generations` | `{request_key, platforms:[Instagram/LinkedIn/Facebook/X], content_type, topic, instructions?}` → 202 safe job summary |
| GET `/content-generations/{job_id}` | Persisted status/stage/error |
| GET `/content-generations/{job_id}/result` | Completed `{posts, strategy, warnings}`; pending/failed → 409 |
| GET `/posts?q=&platform=&status=&limit=50&offset=0` | Company search/filter/page; maximum 100 per page |
| POST `/posts` | ContentDraft + `creation_key`, optional `generation_job_id` and `result_index` → 201; replay returns existing saved draft |
| GET `/posts/{id}` | Editable fields, status, revision and provenance job ID |
| PATCH `/posts/{id}` | Full ContentDraft + `revision`, `status`; stale revision → 409, retained UI edits |
| POST `/posts/{id}/approve` | `{revision}` → approved saved draft; archived records require restore |
| POST `/posts/{id}/duplicate` | `{request_key}` → new draft, replay-safe; no copied media ownership or generation index |
| POST `/posts/{id}/regenerate` | `{request_key}` → new generation job using current confirmed context; original edits retained |
| POST `/posts/{id}/images` | `{request_key}` → 202 image job; unconfigured → 503 `image_provider_not_configured` |
| GET `/posts/{id}/assets` | Asset UUID, MIME, dimensions, size and model; no private storage key |
| GET `/media/{asset_id}` | Membership-authorized file, private/no-store and nosniff; unknown/foreign/missing file → 404 |
| POST `/ai-jobs/{job_id}/cancel` | Cancels and fences active AI work; cannot undo an external charge |

ContentDraft fields: title, platform, content_type, caption, hashtags array, hook, call_to_action, image_prompt and slides array (`heading`, `body`, `visual`). Types: text/image/educational/promotional/thought_leadership/storytelling/carousel/meme. Carousel requires 2–8 structured slides. Meme/image require a visual concept. Carousel slides and memes are outlines/concepts, not rendered assets.

Statuses are `draft`, `ready_for_review`, `approved`, `archived`; archive/restore use PATCH with full current fields and revision. Generated-result saves reject stale brand revisions and invalid/foreign result links. Re-saving the same result returns the existing edited draft, rather than replacing it. Manual drafts/imports do not require a generation job. Creation keys identify an existing logical draft; their replays return that record's current saved edits.

## Gemini, validation and costs

Existing backend `GEMINI_API_KEY` and `GEMINI_MODEL` are reused, with the Google GenAI client explicitly using v1beta and one SDK HTTP attempt. The configured model observed in this environment is `gemini-2.5-flash`; the source default is preserved. No `.env` or user `test_gemini.py` changes were made. Recheck model availability and migration plans before deployment; [current Google pricing/model notices](https://ai.google.dev/gemini-api/docs/pricing) may change.

Each attempt allows one structured response and one schema/quality correction, 30-second request limits and 6,500 output tokens each. Worker attempts default to 2 within 90 seconds cumulative, so a job can make up to four text requests. No unbounded agent loops, automatic frontend mutation retries or unnecessary second evaluator model. Token usage and model are persisted on successful generation, cumulative across correction calls. Failed requests may still be billed and do not always expose token metadata.

`AI_MAX_POSTS=3` (API hard maximum 3), `AI_MAX_PROMPT_CHARS=24000`, shared queue/hourly/attempt/time controls from the competitor handoff apply. System prompts, schemas and correction instructions add fixed overhead to the bounded context. No pricing guarantee is hardcoded into production generation.

Deterministic checks enforce exact requested platform/type coverage, strict bounded schema, case-insensitive hashtag uniqueness (at most 5), excluded-topic matching, nonempty brand/offering term overlap, distinct platform captions, carousel completeness, prohibited links/risky promotional wording, unsupported numeric claims and ten-word contiguous copying against the available competitor context. These checks **cannot establish factual truth, worldwide originality, language quality, clinical safety or regulatory suitability**. Exclusion matching is literal, relevance is lexical, numeric checks use confirmed text and can have false positives/negatives. Review warnings are always returned; no objective numerical quality score is claimed. Human review is mandatory.

Editorial caps include caption and hashtags: Instagram 2200, LinkedIn 2800, Facebook 5000, X 280 weighted units. LinkedIn/Facebook caps are conservative product limits, not claimed maximum API limits. X counts Unicode conservatively, overcounting compound emoji and long URLs and reserving at least 23 for each URL; it is not a full twitter-text implementation. No publishing compatibility is promised. References: [X weighted counting](https://docs.x.com/fundamentals/counting-characters), [Meta media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/), [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).

## Images and private media

Backend settings: `AI_GEMINI_IMAGE_MODEL` has no default and is currently absent; `AI_MEDIA_ROOT=var/media`, `AI_MAX_IMAGE_BYTES=8000000` (maximum 10 MB). Configure an actual supported native generateContent image model independently; listing models does not prove permission or quota. The adapter checks model metadata/actions, requests one image, supports square or 16:9 output, catches permission/quota/model failures explicitly and leaves text-only drafting functional. Imagen predict-only models are not supported by this adapter. No automatic model selection or silent text-model fallback.

Local development storage uses `companyUUID/assetUUID.png` under a private backend root, atomic temporary writes, containment/symlink checks, validated MIME/signature, single-frame PNG/JPEG only, maximum dimension 4096, minimum 64, maximum 16 million pixels, byte limits before/after reencoding and metadata removal. Serving is through authenticated API only; there is no public static mount. The configured root must be on a durable volume shared by API and worker, with deployment-level disk quotas and backup/access controls. It is not production object storage. Pixel-level provider watermarking is not deliberately removed, but metadata reencoding may remove provider metadata; model/job provenance is retained in PostgreSQL.

Failed/stale image commits clean up only their own generated file. Process crashes can leave orphans. `python scripts/cleanup_media.py` is dry-run by default; stop workers, review count and run with `--apply` to remove only unreferenced UUID image/temp files older than 24 hours inside the configured root. Referenced assets and post records are retained, including archived posts. Cancellation cannot recover an image already charged by a provider; stale lease checks prevent attaching it afterward.

Image module status: provider abstraction, validation, private storage, authorized retrieval and UI unavailable/error states are implemented; **live image access and a real generated image are unverified**. No stock/SVG/template graphic is presented as real AI output.

## Frontend and recovery

Existing components, CSS/layout and SocialAI colors are reused. Dashboard Content Studio defaults to Gemini generation, restores latest persisted job/results on refresh, shows truthful status, supports editing/copy/save and links to saved posts. A saved result can only create one logical draft; subsequent edits belong in My Posts. My Posts supports server search/platform/status filters, 50-row pagination, editable captions/tags/platform/slide text/visual concepts, revision conflict messages, explicit review/approval, duplication, archive/restore, regeneration and image preview/open/download when available.

Legacy template generation/local scheduling are retained behind `Use demo templates` and `View browser demo drafts`. Onboarding still defaults to its explicitly labelled demo generation and offers real mode; completed demo progress is not represented as real publishing. The calendar/analytics remain legacy demo simulations; real drafts are not silently scheduled or published. Browser-draft import is explicit, copies text only to the selected company, retains originals, uses company/local-ID creation keys and rejects invalid content. No background imports or database inserts occur on refresh. Company changes remount real views to prevent stale data leakage. Polling cancels on unmount; failed status retrieval offers reload. Pending request and save keys persist in company-scoped localStorage for lost acknowledgements. Unsaved real-editor text is retained during errors in the mounted editor but does not have a separate refresh recovery cache; save before navigating away.

## Verification

Initial implementation checks: Phase 5 checkpoint 8 tests; integrated backend 135 tests passed after content/cancellation integration; frontend unit 38 passed; TypeScript passed; lint passed with zero warnings after final UI cleanup. Alembic upgrade succeeded and `alembic check` detected no new operations. Full final check results will be appended after browser/build verification.

New backend coverage includes strict platform/tags/slides, strategy/preferences, excluded/risky/numeric claims, alignment, no-competitor generation, unconfirmed-brand rejection, bounded invalid-output correction, mocked worker completion, raw-result/edit separation, duplicate prevention, stale revisions, approval/archive/restore, private media signature/path validation, mocked image worker and authorized serving, foreign scope denial and cancellation fencing. Routine tests use real PostgreSQL rollback fixtures with mocked external providers.

Live text smoke succeeded with a retained smoke company/job/post:

- Company `59a18322-264b-4e99-8348-c78a343ae4f4`
- Completed job `1ed85068-00b1-4dc3-a766-4be4bbc7e812`
- Saved draft `712fccd7-9497-46de-9bbf-f9ecdd162f16`
- One LinkedIn educational draft generated by the configured Gemini, validated and fetched back from PostgreSQL. No search/image requests.

Earlier smoke preparation found and fixed an audience-shape issue and standalone model registration; the first inference found a wire-schema property-name bug, now regression-covered. Those preparation attempts did not produce drafts; retained smoke records are not removed. Live tests are opt-in: `python scripts/smoke_content.py --run-live --max-budget-usd 0.05`. It caps itself to one worker attempt/two text calls, requires the audited model, and uses published 2026-11-15 Gemini 2.5 Flash rates $0.30/M input and $2.50/M output; recheck pricing before running. SDK retries disabled. The script intentionally retains its account/company/job/post and never prints login credentials.

## Manual demo and next phase

1. Install backend requirements, migrate to head, start API, worker and frontend separately. Configure backend Gemini access; confirm the selected brand and review content preferences.
2. Optionally research and approve competitors; proceed without them when unavailable.
3. In Content Studio, choose platform/type/topic, Generate, observe actual queued/running/completed or controlled error. Refresh to recover results; review and edit, then Save draft.
4. Open My Posts, edit and save, refresh/log out/in, verify persistence. Test a stale second-tab edit; it must return 409 without overwriting the server draft.
5. Mark ready for review, explicitly approve, duplicate, archive and restore. Regenerate an alternative and verify original edited text remains intact.
6. Request an image: currently expect the explicit unavailable state. With a separately enabled model, verify one generated asset, authenticated preview/download and cross-tenant 404. Live image verification remains outstanding.
7. Explicitly import browser demo drafts if desired; verify originals remain in demo view and repeat import produces no duplicates.

Before scheduling/publishing: durable scheduler/outbox, timezone semantics, social OAuth with encrypted scoped tokens, provider app review, account permissions, current platform constraints, real media upload processing, publication idempotency, audit logs, quota monitoring, retry reconciliation, webhook verification, retention/deletion policy and worker/media deployment hardening. None of that publishing infrastructure is simulated as real in these phases.

## Exact Phase 5–6 file inventory

Created:

- `backend/alembic/versions/1015bf067be2_add_competitor_intelligence_and_shared_.py`
- `backend/alembic/versions/42e2d03f6e9d_add_editable_posts_and_private_.py`
- `backend/app/api/intelligence.py`, `backend/app/api/content.py`
- `backend/app/core/intelligence_config.py`
- `backend/app/models/intelligence.py`, `backend/app/models/content.py`
- `backend/app/schemas/intelligence.py`, `backend/app/schemas/content.py`
- `backend/app/services/search_provider.py`, `backend/app/services/competitor_intelligence.py`, `backend/app/services/ai_queue.py`
- `backend/app/services/content_generation.py`, `backend/app/services/content_handlers.py`, `backend/app/services/media_storage.py`
- `backend/app/workers/intelligence.py`
- `backend/scripts/smoke_content.py`, `backend/scripts/cleanup_media.py`
- `backend/tests/test_competitor_intelligence.py`, `backend/tests/test_content.py`
- `frontend/src/lib/intelligence-api.ts`, `frontend/src/lib/content-api.ts`
- `frontend/src/store/use-ai-job.ts`
- `frontend/src/components/real-competitors.tsx`, `frontend/src/components/content/real-content.tsx`
- `frontend/tests/e2e/intelligence.spec.ts`, `frontend/tests/unit/content-api.test.ts`
- `docs/competitor-intelligence.md`, `docs/ai-content-generation.md`

Changed existing files:

- `.gitignore` (private development media)
- `backend/alembic/env.py`, `backend/app/main.py` (model/router registration)
- `backend/app/workers/extraction.py` (shared dispatch)
- `backend/requirements.txt` (Pillow 12.3.0)
- `frontend/src/components/competitors.tsx`, `frontend/src/components/content/studio.tsx`, `frontend/src/components/dashboard/posts.tsx` (real/demo routing)
- `frontend/tests/e2e/journey.spec.ts` (explicit demo selection in existing regression)
- `frontend/playwright.config.ts` (15-second assertion timeout for authenticated restoration; all assertions retained)

Existing uncommitted Phase 2–4 changes and tracked Python bytecode artifacts predate or reflect running the workspace; this inventory is not the entire dirty Git tree. Historical handoff documents, `.env`, `config.py`, `test_gemini.py` and earlier migration files are preserved.

## Final verification record

Full browser regression: 17/17 passed, including all 15 existing regressions and 2 new competitor/content journeys. The real-content browser fixture mocks Gemini output and bridges its fixture save to the real manual-draft API; actual generated-job provenance and immutable-result separation are covered by PostgreSQL backend tests and the successful live text smoke. All provider calls in routine tests are mocked.

Initial browser runs exposed stale demo selectors and the legacy `.example` own-company URL error; these are fixed. A concurrent diagnostic Playwright run also collided with the shared trace directory; the final full run was isolated and passed. No tests were deleted, skipped or disabled. Mobile screenshot inspection led to shortening the edit-button label while preserving its accessible full title. Final targeted browser/build results follow below.

Final checks after the identity, observability and mobile-label fixes: **135 backend tests passed**, **38 frontend unit tests passed**, **17 full browser regressions passed**, and the **2 affected browser journeys passed again** after the final UI change. TypeScript, ESLint (zero warnings), optimized production build, Alembic schema check and Git whitespace check passed. Media cleanup dry-run found zero orphan files. The shared worker was restarted on the final code and is running. Live image/search checks were not run and remain explicitly incomplete. No test is skipped. Vitest emits an existing configuration-loader compatibility advisory; it does not fail the suite.
## Published brand posts

In Content Studio and the final onboarding step, open **Learn from published posts**. If the company has an authorized Facebook Page or Instagram professional account feed, SocialAI samples up to six published posts per account when you generate. You can also paste up to six published captions, with `---` on a separate line between captions.

The draft uses observed content categories, media formats, caption length, question openings, hashtag count, and calls to action as editorial cues. The result shows which samples informed the draft. SocialAI stores the aggregate profile with the generation rather than the fetched posts or pasted captions. The profile describes the available sample and provides no performance metrics or new product claims.

To enable a read-only feed, set `BRAND_SOCIAL_META_ACCOUNTS` in `backend/.env` to a JSON array of company configurations. Each object needs a SocialAI `company_id`. Facebook also needs `facebook_page_id` and an authorized `facebook_page_token`. Instagram uses `instagram_account_id` and an authorized `instagram_user_token` for Instagram API with Facebook Login. Configure only accounts the company has authorized and keep tokens server-side. `BRAND_SOCIAL_META_VERSION` can override the Graph API version. Restart the API and shared worker after changing configuration. Instagram and Facebook can be enabled independently. The caption example option is available for any platform. [Facebook Page published posts](https://developers.facebook.com/docs/graph-api/reference/page/published_posts) · [Instagram professional account media](https://developers.facebook.com/docs/graph-api/reference/shadow-ig-user/media/)
