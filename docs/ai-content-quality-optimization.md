# SocialAI Phase 8A.1 — AI image quality, content intelligence and product optimization

Status: implemented and verified on 19 November 2026. Social publishing and LinkedIn integration are unchanged (Phase 8A code, migration and configuration states are preserved; no social credentials are required or used).

## 1. Current implementation audit (Phase 0)

| Area | What existed | Assessment |
| --- | --- | --- |
| Text generation | `content_generation.generate`: `gemini-2.5-flash`, strict JSON schema, one bounded correction call, claim/number/link/competitor-overlap validation, editorial caps | Safety rules were solid. Copy was generic: one fixed CTA ("Invite a conversation"), objective always the first saved goal, no platform conventions, no memory of earlier posts. |
| Image generation | `post_media.image_brief` (flat list of ~13 lines) + `GoogleImageProvider` (`gemini-3.1-flash-image`, generateContent, aspect ratio only) | Root cause of most image problems (see §2). |
| Image storage | Validated, metadata-stripped PNG in private local storage; authenticated serving | Sound; no change needed beyond provenance metadata. |
| Regeneration | "Regenerate image" with an optional free-text direction; every image kept; revision protection for approved posts | Only one kind of variation; no lineage, no edit input, no record of which brief produced which image. |
| Quality checks | File validation only | No check of ratio, blankness, duplicates, rendered text or palette; no accept/reject. |
| Studio | Platform, content type, topic, instructions, image toggle and ratio | No objective, audience, tone, style or composition controls; caption regeneration only for saved posts. |
| Reliability | Lease-fenced worker, capacity reservation, text never blocked by images | Every image made an extra model-metadata request; linear retry backoff; no prompt version or provider request ID stored. |
| Phase 7.7 competitor UI | Documented complete in `docs/competitor-ui-redesign.md` | Verified present; no changes required. |

Baseline recorded before any change: backend **327 passed**, frontend unit **77 passed**, browser **42 passed** (Phase 8A run); Alembic head `201c3d52e47b`; 21 tables / 6,815 rows snapshotted (row counts + ordered content hashes); `.env` SHA-256 backend `f495a652…bb911`, root `f9e26964…c722c`.

## 2. Root causes of the quality issues

Evidence: the 12 images generated live before this phase (stored assets), and a fresh before/after run with identical briefs (§5).

1. **Raw hex codes in the prompt.** The old brief and the text model's visual concept repeated codes such as `#3b2417` and said "use this exact palette prominently". The model responded with near-monochrome images (Akoode blue-on-white, Scafos sage swirl) and, in the café benchmark, painted the palette as a swatch bar across the photo.
2. **Rendered text despite "no text".** The Akoode images contain an "AI" chip label; it was reproduced in the benchmark's legacy run. Nothing detected it.
3. **Icon soup from listing every offering.** "Offerings to depict: AI solutions, Software Development, Mobile App, Web" produced collages of generic tech icons rather than one subject.
4. **Contradictory style signals.** A fixed "editorial" system instruction plus the brand's free-text preference ("abstract geometric illustrations") plus "photographic or illustrative as fits".
5. **No industry direction or objective.** Nothing told the model how a dental clinic differs from a café, or that a promotion needs the offering as hero.
6. **Generic captions.** Live Akoode captions opened with "In today's dynamic business environment…", used "Unlock / Elevate / empowers", and every CTA was "Connect with us".

## 3. Before-and-after prompt examples

Full before/after briefs for every benchmark category are in `frontend/artifacts/quality-benchmark/prompts-live.md` (live) and `prompts-offline.md` (deterministic). Abridged café example:

**Before (legacy)**
```text
Social media creative for Instagram (promotional), aspect ratio 4:5.
Create one original editorial image with an immediately recognizable subject, …
Brand color references: #3b2417, #d4a373, #f5ebe0. Use them where they support the composition. …
No logos, brand names, watermarks, identifiable real people, testimonials, numbers, claims or rendered text. …
Brand: Brew & Bean Roasters. Industry: Specialty coffee.
Offerings to depict: Single-origin coffee beans, Brewing workshops.
Visual concept: … warm brand colors (#3b2417, #d4a373, #f5ebe0) …
Visual style preference: not specified.
```

**After (image-brief-v2)**
```text
1. Core subject: <visual concept> The image must clearly relate to this confirmed offering: Brewing workshops. Post topic: …
2. Industry context: Brew & Bean Roasters works in Specialty coffee. Appetising close-ups of the actual menu category with real texture …
3. Marketing objective: Product/service promotion: make the offering desirable and clearly visible as the hero.
4. Brand visual direction: Photorealistic: … Brand personality: Warm, Knowledgeable.
5. Composition and framing: The offering itself is the hero and fills roughly half the frame. One clear focal point …
6. Lighting and aesthetic: Natural, believable light consistent with the setting. …
7. Colour guidance: Brand palette: deep brown (#3b2417), caramel (#d4a373), cream (#f5ebe0). Use the brand colours as key accents (roughly a third of the frame) … Colours are visual cues only; never write colour codes in the image.
8. Output: one image for Instagram at aspect ratio 4:5. Portrait 4:5 feed frame: … Compose natively for this frame; do not letterbox or stretch.
9. Restrictions (always apply): No logos … No rendered text, letters, numbers or labels anywhere, including on screens, icons, packaging and signage. … Avoid clichés for this industry: plastic-looking food, impossible portions …
```

Caption prompt (`caption-v2`): the strategy now carries `objective_playbook` (goal, hook, structure, CTA), `platform_conventions` per requested platform, `recent_posts_to_avoid`, optional `audience`, `tone`, `campaign` and `supplied_evidence`, plus an explicit list of generic phrases to avoid and "vary the CTA".

## 4. Changes to the image prompt architecture

`backend/app/services/image_prompt.py` (new) builds a ten-section brief:

1. Core subject — the post's visual concept and **one** confirmed offering, chosen by overlap with the topic.
2. Industry context — category detected from the confirmed industry/business type (technology, healthcare, food, fashion, e-commerce, real estate, education, travel, finance, other) with a *how-to-depict* direction. The subject still comes from the brand's offerings, not from a stereotype.
3. Marketing objective — eight objectives (educational … promotional campaign); falls back from content type.
4. Brand visual direction — exactly one style: the user's selection, else the style implied by the saved visual preference ("illustrations" → Modern Illustration), else the industry's first recommendation. An explicit selection replaces the saved preference instead of being combined with it.
5. Composition and framing — subject emphasis, negative space, detail level, background.
6. Lighting and aesthetic — per style.
7. Colour guidance — plain-language colour names with the code once (e.g. "sage grey (#929c87)"), an intensity rule instead of "prominently", contrast analysis (WCAG luminance) adding complementary neutrals for narrow/low-contrast palettes, and "never write colour codes in the image".
8. Output — platform, ratio and ratio-specific framing (9:16 safe zone, 16:9 offset), "compose natively; do not stretch".
9. Restrictions — always last-but-one and declared non-overridable: no logos/brands/people/claims, no text unless exact wording is supplied, illustrative products only, industry clichés to avoid, excluded topics, competitor themes, user "things to avoid".
10. User customization — free-text direction, explicitly ranked below restrictions.

The brief is bounded at 3,200 characters (the concept is trimmed first; restrictions are never dropped). `build_brief` returns metadata (prompt version, industry, resolved style and its source, objective, palette names, chosen offering, options) that is stored with every image. The provider system instruction no longer forces "editorial".

## 5. Side-by-side image comparisons

See §12 (live results) for the scorecard. Comparison sheets: `frontend/artifacts/quality-benchmark/<category>-comparison.png`; raw images `<category>-before.png` / `<category>-after.png`; extra formats `technology-after-16x9.png`, `cafe-after-9x16.png`; end-to-end pipeline images `pipeline-*.png`. Historical live images from before this phase (Akoode ×2, Scafos ×2, Bakingo, Brew & Bean) are in `quality-benchmark/historical-pre-phase-images.png` and summarized in §2.

## 6. New creative controls

| Control | Where | Values |
| --- | --- | --- |
| Content objective | Studio brief | From saved goals, Educational, Brand awareness, Product/service promotion, Thought leadership, Engagement, Announcement, Case study (requires evidence), Promotional campaign |
| Audience, caption tone, campaign context, evidence | Studio brief | Optional overrides; evidence shown for case studies/announcements |
| Visual style | Studio brief and variations | Auto / Brand recommended, Premium Minimal, Photorealistic, Editorial, Professional Corporate, 3D Product Render, Modern Illustration, Cinematic, Lifestyle, Abstract Technology, Custom. Industry-recommended styles are listed first (from `/ai-capabilities`); all remain selectable. |
| Aspect ratio | Studio brief, result and post panels | 1:1, 4:5, 3:4, 4:3, 16:9, 9:16 (API also 3:2, 2:3) |
| Advanced image settings (collapsed) | Studio brief | Colour intensity, background, subject emphasis, negative space, composition detail, product imagery, text in image (exact text ≤ 6 words, same claim checks as captions, always "Needs review" with an error warning), things to avoid |
| Refine image | Result image and saved-post image panels | Same brief, custom instructions, refine (AI edit), change style, change background, adjust colour emphasis, simplify, alternative direction (rotates subject emphasis), another platform format |

Defaults keep the one-click path: only the topic is required, and "Auto" everywhere reproduces the brand-recommended, no-text behaviour.

## 7. Image quality checks

`backend/app/services/image_quality.py` (new), run by the worker for every generated image before it is attached:

- Deterministic (no API cost): decodes the stored file; resolution (short edge ≥ 512 px); requested vs actual aspect ratio (±3%; a mismatching image is stored unchanged — never stretched or cropped — and flagged); near-uniform output (luminance standard deviation); brand-palette presence (share of pixels within ΔE76 ≤ 22 of each brand colour, 64×64 sample, reported as approximate); near-duplicates of earlier versions of the same post/result (64-bit dHash, Hamming ≤ 6); requested text always flagged for manual proofreading.
- Optional model opinion (`AI_IMAGE_REVIEW=true`, default off; one call per image, `thinking_budget=0`, ≤ 500 output tokens, 25 s timeout): subject alignment, transcribed visible text, artifacts, brand suitability. Stored as "AI reviewer opinion … not an objective score". Failure or timeout records `unavailable` and never fails the image.
- Result: `ready_for_review` or `needs_review` (`quality_status` + full `quality_report` on the asset). "Generation failed" is the image job's failed state. Images are never discarded or auto-retried because of a check.
- Manual review: `POST /media/{asset_id}/review {decision: accepted|rejected|null}` (owner/admin). The decision is not a content change (no revision bump). Approving a post whose chosen image is rejected returns 422; rejected images cannot be selected as the post image from the gallery.
- Images created before this phase show "Not checked (earlier image)" rather than an invented result.

## 8. Caption quality improvements

- Objective resolution: request → saved goals mapped to objectives → content type.
- Platform conventions: LinkedIn (first line < 150 characters for "see more", 80–220 words, 2–3 hashtags), Instagram (40–150 words, 3–5 hashtags, sparing emoji), Facebook, X.
- Audience, tone and campaign overrides; `evidence` is the only additional permitted source of numbers/outcomes and is required (≥ 20 characters) for case studies.
- Anti-repetition: the six most recent saved posts' openings are supplied as "avoid"; deterministic similarity (word-trigram Jaccard ≥ 0.3) against them and ≥ 0.5 between platform versions is reported.
- Generic-phrase detection (unlock, elevate, seamless, empower, "in today's…", etc.) — phrases that appear in the brand's own confirmed description/guidelines are not flagged. Two or more in one post trigger **one** bounded rewrite; if the rewrite fails validation the valid first draft is returned with its warnings (a valid draft is never lost).
- Per-post quality report returned with every result (`quality`): brand/offering relevance, topic coverage, factual grounding, specific wording, repetition, platform fit. Each check is pass/warn with evidence; there is no numeric score.
- Existing safeguards unchanged: numeric-claim validation applies to published copy only (hex colours and dimensions in visual concepts remain allowed — regression test retained), certification/award/guarantee/link rules, competitor-overlap, excluded topics. Temperature 0.7 → 0.8 for more varied phrasing (validation is unchanged).
- `generation_meta` per result: model, prompt version, attempts, duration and the provider `response_id`/`model_version` when returned. Token usage is recorded only from provider metadata.

## 9. Performance and reliability improvements

| Item | Change |
| --- | --- |
| Duplicate API requests | Image model capability check cached per process for 10 minutes (previously one extra `models.get` per image). |
| Request cancellation | Studio capability/result loads, result media polling and post asset loads use `AbortController` and cancel on unmount/company switch. |
| Retry/backoff | Transient failures back off exponentially (5 s, 10 s, … capped at 60 s) within the existing attempt budget; quota (429) and edit rejections (400) are permanent. |
| Error categories | New `image_edit_rejected`; provider "no image" message clarifies the model may have declined the brief. Text failure and image failure are labelled separately in the UI. |
| Storage failures | If evaluation fails after a file is written, the file is removed before the error propagates (no orphan). Existing atomic writes and lease-fenced commits retained. |
| Edits with a missing source file | Fall back to a fresh generation and record the note on the asset (never claimed as an edit). |
| Observability | Per asset: `prompt_version`, `generation_mode` (fresh/edit), `parent_asset_id`, operation and options, `provider_request_id`, `duration_ms`, `perceptual_hash`, quality report. Job results include the same summary. |
| Cost | No generation runs on page load/refresh; Studio only restores existing results. AI review is opt-in and bounded. Variations count against the existing hourly limits and the 20-images-per-post cap. |
| Logging | No prompts, keys or user data are logged by the new code; benchmark/smoke scripts print only IDs, statuses and measurements. |

## 10. Modified files

New:
- `backend/app/services/image_prompt.py`, `backend/app/services/image_quality.py`
- `backend/alembic/versions/09efca8855d4_add_image_generation_provenance_and_.py`
- `backend/tests/test_content_quality.py`
- `backend/scripts/quality_benchmark.py`, `backend/scripts/benchmark_baseline.py`, `backend/scripts/smoke_image_quality.py`
- `frontend/src/lib/creative-options.ts`, `frontend/src/components/content/image-controls.tsx`, `frontend/src/app/content-quality.css`
- `frontend/tests/unit/creative-options.test.ts`, `frontend/tests/e2e/content-quality.spec.ts`

Changed:
- Backend: `app/services/post_media.py` (brief delegation, variations, overlay-text claim checks, asset view), `app/services/content_generation.py` (caption-v2 strategy, quality report, metadata, bounded rewrite), `app/services/content_handlers.py` (edit input, quality evaluation, provenance), `app/services/media_storage.py` (provider: reference image, capability cache, request IDs, system instruction), `app/services/ai_queue.py` (exponential backoff), `app/api/content.py` (variation parameters, result caption endpoint, review endpoint, approval guard), `app/api/intelligence.py` (image capabilities), `app/schemas/content.py`, `app/models/content.py`, `app/core/intelligence_config.py`, `tests/test_post_media.py` (brief assertions updated to the v2 sections).
- Frontend tests: `tests/e2e/competitor-research.spec.ts` (one assertion: the Studio panel heading is now "Creative brief" instead of "Create something worth sharing")
- Frontend: `src/components/content/real-content.tsx` (Studio redesign), `post-media.tsx` (quality, review, versions, variations), `post-revisions.tsx` (caption regeneration for unsaved results), `post-library.tsx` (label), `src/lib/content-api.ts`, `src/app/layout.tsx`.

## 11. API and database changes

Database — migration `09efca8855d4` (down-revision `201c3d52e47b`), additive only. Nullable `post_assets` columns: `parent_asset_id` (composite FK to `post_assets(id, company_id)`, same tenant only), `generation_mode`, `prompt_version`, `generation_options` (JSONB), `provider_request_id`, `duration_ms`, `perceptual_hash`, `quality_status`, `quality_report` (JSONB), `review_decision`, `reviewed_by`, `reviewed_at`; unique `(id, company_id)`; checks on mode, quality status, decision, and decision ⇔ timestamp. No existing row is modified; `alembic check` is clean.

API (all under `/api/v1/companies/{company_id}`, existing auth, membership and Origin policy):

| Endpoint | Change |
| --- | --- |
| `POST /content-generations` | Optional `objective`, `audience`, `tone`, `campaign`, `evidence` (required for `case_study`), `image_options`. Result adds `quality`, `generation_meta`. |
| `POST /content-generations/{job}/results/{i}/caption` | New. Queues a caption-only rewrite for an unsaved result (no images). |
| `POST /content-generations/{job}/results/{i}/images`, `POST /posts/{id}/images` | Optional `operation`, `parent_asset_id`, `options`. Missing choices inherit from the source image. Edit-capable operations send the source image; `platform` composes a new image at the requested ratio. |
| `POST /media/{asset_id}/review` | New. Accept, reject or clear (owner/admin). |
| `POST /posts/{id}/approve` | 422 if the chosen image is rejected. |
| `GET /posts/{id}/assets`, `GET /content-generations/{job}/media` | Assets add provenance, quality and review fields. |
| `GET /ai-capabilities` | Adds `visual_styles`, `recommended_styles`, `industry_category`, `image_prompt_version`, `image_review_enabled`, `image_edit_enabled`. |

Configuration (all optional; `.env` was not modified): `AI_IMAGE_REVIEW` (default false), `AI_IMAGE_REVIEW_MODEL` (defaults to `GEMINI_MODEL`), `AI_IMAGE_REVIEW_TIMEOUT` (25), `AI_IMAGE_EDIT_ENABLED` (true). Model names are unchanged (`gemini-2.5-flash`, `gemini-3.1-flash-image`). Capability basis: the configured image model's documentation lists text-and-image editing input and the 1:1, 4:5, 9:16 and 16:9 ratios used here; actual output sizes were confirmed live (1024×1024, 928×1152, 768×1376, 1376×768) and every image's real dimensions are validated and stored.

## 12. Live generation results

All live calls used the existing key and models (`gemini-2.5-flash` text, `gemini-3.1-flash-image` images). No `.env` change, no model change. Brand data was read-only (Akoode Technologies, the Brew & Bean Roasters smoke brand, Scafos) plus one synthetic dental fixture.

### 12a. Before/after benchmark

Command: `scripts/quality_benchmark.py --run-live --max-images 10 --max-text 12 --ai-review`. Same creative brief per category; "before" = frozen pre-8A.1 prompts (`scripts/benchmark_baseline.py`), "after" = image-brief-v2 / caption-v2 (the version live at the time of the run). Raw data: `frontend/artifacts/quality-benchmark/scorecard-live.json`; prompts in `prompts-live.md`.

| Category | Before image | After image |
| --- | --- | --- |
| Technology / AI services (Akoode, 1:1) | Generic glowing "AI" chip in an icon cluster; **rendered text "AI"** (transcribed by the AI reviewer) | Text-free illustration of scattered items sorted into folders, directly depicting the topic (ticket triage) and following the brand's saved illustration preference |
| Café (Brew & Bean, 4:5) | Good pour-over photo, but the **brand palette is painted as a swatch bar** across the bottom | Clean photorealistic pour-over scene; palette present as tones; no artifact |
| Fashion / textiles (Scafos, 4:5) | Workshop scene with an **identifiable woman's face**; label text "ORGANIC COTTON" | Sketch-to-finished-scarf still life, exactly on topic, no person; **but handwritten annotations on the sketch page** (transcribed by the reviewer), and blue/orange dominate the sage palette |
| Healthcare (synthetic dental, 4:5) | Calm, child-friendly treatment room | Comparable room; a small book cover reads "Going to the dentist" (seen on inspection; the AI review call was unavailable for this image) |

Automated measurements (both sides evaluated identically):

| Measure | Before (4 categories) | After (4 categories) |
| --- | --- | --- |
| Images with rendered text (AI reviewer transcript, plus inspection for the unreviewed image) | 2 of 4 | 2 of 4 (different causes: sketch notes, book cover) |
| Palette rendered as a swatch or strip | 1 | 0 |
| Identifiable person | 1 | 0 |
| Requested ratio delivered | 4 of 4 | 4 of 4, plus 16:9 → 1376×768 and 9:16 → 768×1376 |
| Deterministic image status | 4 ready_for_review | 4 ready_for_review |
| Caption sets passing grounding/relevance validation | 3 of 4 (technology captions never named the brand or an offering, so production would have rejected and retried them) | 4 of 4 |
| Posts containing generic filler phrases | 4 of 8 (unlock, elevate ×2, delve, seamless) | 3 of 8 (seamless ×2, elevate) |
| LinkedIn first line under 150 characters | 0 of 4 | 0 of 4 (the model wrote single paragraphs) |
| Hooks phrased as an audience question or problem | 0 of 8 | 4 of 8 (e.g. "Is your customer support overwhelmed by incoming tickets?") |
| CTAs using "Connect with us" | 1 of 8 | 0 of 8 |
| Text calls per category | 1 | 1–2 (two categories used the bounded rewrite or correction) |
| Image generation time | 10.5–12.3 s | 8.8–11.3 s |

Interpretation: clear improvements in topic fidelity, palette handling, people safety, caption relevance and hook specificity. There was no improvement yet in LinkedIn first-line formatting and only a partial reduction in filler words, and rendered text on in-scene surfaces (sketches, books) remained. These three findings led to the v2.1 refinements (§12c).

Example (café, Instagram). Before: "Elevate your morning ritual! Our weekend pour-over brewing workshop … can unlock distinct flavors …". After: "Looking to perfect your pour-over technique at home? Our weekend brewing workshop covers everything from grind size to water temperature …".

### 12b. End-to-end pipeline

Command: `scripts/smoke_image_quality.py --run-live --max-images 3`, through the real API and the restarted shared worker, with a new smoke account and the fictional brand "Harbor Light Travel" (company `2ea627af-a0fe-49df-9b22-88631ea1b562`, retained).

| Step | Result |
| --- | --- |
| Text (caption-v2, brand awareness) | Completed in 10.3 s, 2 attempts; all six caption checks pass; `response_id` recorded |
| Result image (Lifestyle, environment emphasis, 4:5) | 928×1152 PNG, `image-brief-v2`, fresh, 11.1 s, ready_for_review, brand colours present |
| Save → approve → "Change background" variation | Ran as an **edit** with the source image (`generation_mode=edit`, parent recorded), 10.4 s. The approved post **returned to draft** (revision 3 → 4). The check flagged it as a near-duplicate of its source. That was a false alarm for edits; it is fixed (edits are now flagged only if virtually unchanged) and covered by a test |
| "Another platform format" 9:16 | Fresh composition at 768×1376 (not stretched), parent recorded, ready_for_review |
| Accept review, re-login | Decision and all three versions persisted; downloads succeeded |

Images: `frontend/artifacts/quality-benchmark/pipeline-*.png`. Visual check: coherent coastal-walk scenes with figures seen from behind (non-identifiable) and no text.

### 12c. v2.1 refinements and the provider limit

Changes made from the evidence above:
- Colour codes in the text model's visual concept are converted to colour names before they reach the image model.
- New restriction: any paper, notebook, sketch, book cover, screen or package stays blank.
- LinkedIn and Instagram conventions require the hook alone on line 1, followed by a blank line.
- The caption system prompt asks for colour names and blank surfaces.

Prompt versions: `image-brief-v2.1`, `caption-v2.1`.

A controlled re-run of three categories (≤ 6 images) stopped at its first call with **HTTP 429 RESOURCE_EXHAUSTED: "Your project is temporarily rate-limited to prevent exceeding its monthly spending cap."** No retry was attempted. **The v2.1 refinements are therefore verified only by automated tests and offline prompt output, not by live images.** Re-run with `python scripts/quality_benchmark.py --run-live --max-images 6 --max-text 12 --ai-review --only technology fashion healthcare --skip-extra --tag v21` after the spend cap is raised or resets.

Live usage in this phase: 13 images, 7 AI-review calls (1 unavailable), about 12 text calls, and 1 rejected call (429). Token counts are recorded in the scorecard and on the jobs only where the provider returned them; no monetary cost is estimated.

### 12d. Reviewer scorecard

Reviewer: Claude (AI assistant), by visual inspection of the saved files using the criteria below. These are not human ratings. "+" means the after version is better, "=" means no clear difference, "−" means the after version is worse.

| Criterion (evidence) | Tech | Café | Fashion | Healthcare |
| --- | --- | --- | --- | --- |
| Brand relevance (offering visible, palette used sensibly) | + | + (no swatch) | = (on topic, palette weaker) | = |
| Industry relevance (depiction suits the category, avoids clichés) | + (no AI-chip cliché) | = | + | = |
| Prompt adherence (no text, logos or identifiable people; ratio) | + (text removed) | + | − (annotations), + (no face) | − (book title) |
| Image/text consistency (image depicts the caption topic) | + | = | + | = |
| Caption quality (specific hook, fewer fillers, brand named) | + | + | + | = |
| Factual correctness (validation, no invented claims) | + (before failed relevance) | = | = | = |
| Platform fit (ratio, hashtags, LinkedIn first line) | = | = | = | = |
| Visual diversity (distinct from earlier brand images) | + | = | + | = |

## 13. Automated test results

| Suite | Before phase | After phase |
| --- | --- | --- |
| Backend pytest | 327 passed | **347 passed** (20 new in `tests/test_content_quality.py`; `test_post_media.py` brief assertions updated to the v2 structure) |
| Frontend unit (vitest) | 77 passed | **84 passed** (7 new in `creative-options.test.ts`) |
| Browser (Playwright, SocialAI dev server on :3001) | 42 passed | **44 passed in one run** (6.1 min; 2 new). The first full run had 1 failure: the competitor test still expected the old Studio heading. After updating that assertion, the whole suite was re-run |
| TypeScript, ESLint, production build | pass | pass |
| `alembic check` | clean at `201c3d52e47b` | clean at `09efca8855d4` |

New backend coverage includes:
- **Brief structure:** ten-section order and length bound; industry detection (tech, food, healthcare); offering selection; mapping a saved preference to a style; an explicit style replacing the saved preference; colour naming and contrast; hex-to-name conversion; the text-in-image switch.
- **Validation:** option and variation validation; overlay-text claim rejection.
- **Deterministic checks:** ratio mismatch stored without stretching; blank image; duplicate and edit-aware duplicate; palette; text warning; undecodable file. Also AI-review merging and failure isolation.
- **Worker and variations:** provenance when the provider returns the wrong ratio; an edit variation sends the previous image and inherits ratio and options; a platform variation is a fresh generation; a missing source file falls back honestly; a variation on an approved, scheduled post returns it to draft and blocks the schedule; image options and objective flow through text-with-image generation.
- **Review and access:** accept, reject and clear; the approval guard; member 403; cross-tenant 404; capabilities.
- **Captions:** objective resolution, conventions and evidence numbers; the quality report (generic, repetition, platform); the bounded rewrite and its fallback; the result caption endpoint.
- **Provider and queue:** capability cache, reference image, 400 mapping, exponential backoff.

New browser coverage (`tests/e2e/content-quality.spec.ts`; providers mocked; saved posts, uploads and reviews real):
- The creative brief lists industry-recommended styles first, enforces the case-study evidence and text-in-image gates, and sends the expected request payload.
- The preview card, image checks and caption checks render. A background variation is labelled as an AI edit, the platform variation shows its note, and a caption suggestion can be applied.
- At 390 px there is no horizontal overflow.
- Reject blocks approval; accept allows it. A variation on an approved post requires confirmation.

## 14. Screenshots and examples

`frontend/artifacts/`: `content-studio-brief-desktop.png`, `content-studio-preview-desktop.png`, `content-studio-mobile.png`, `post-image-review-desktop.png`, and `quality-benchmark/` (comparison sheets, raw before/after images, extra-ratio images, pipeline images, scorecards, prompts).

## 15. Known limitations

- **Live verification of v2.1 is outstanding** because the Gemini project hit its monthly spend-cap rate limit (§12c).
- Rendered text on in-scene surfaces is model behaviour: prompts reduce it but cannot guarantee its absence. The deterministic checks cannot read text; only the optional AI reviewer can, and it is off by default (`AI_IMAGE_REVIEW=false`) to avoid extra cost. Enable it to have such images marked "Needs review" automatically.
- "AI edit" variations re-render the whole image, guided by the previous one. They are labelled as such and are not pixel-precise edits.
- Palette presence is an approximate colour-distance measure. A brand-colour "pass" means at least one colour covers 1% or more of a 64×64 sample.
- Caption checks are lexical heuristics (generic-phrase list, trigram similarity, word and hashtag ranges). They cannot establish factual truth or tone quality, so human review remains mandatory.
- The platform preview card is a layout approximation, not an exact rendering of any network's UI.
- Storage remains local development storage. Social publishing and analytics remain out of scope.

## 16. Remaining product risks

1. Spend-cap or quota exhaustion now blocks all generation for this project. The app correctly reports `gemini_rate_limited` / `image_quota`, but users cannot generate until the cap changes.
2. The single shared worker must be restarted after deployments; it was restarted twice during this phase. A stale worker would run old prompts.
3. Generic-phrase detection uses a fixed English list; other languages are not covered.
4. Repeated variations accumulate paid images, capped at 20 per post and by the hourly limits.
5. Industry detection relies on the confirmed industry text. Unusual wording falls back to the "other" direction, which is still brand-specific but less tailored.
6. Images from before this phase show "Not checked". No back-fill was run; a deterministic back-fill could be added at no API cost.
7. Phase 7 reliability audit: the only production-facing demo wording left was the "Recover browser demo drafts" import in the Post Library. It is relabelled "Recover drafts saved in this browser" and keeps working as a data-recovery path. No other reachable demo states were found (the Analytics page already shows an honest "not connected" state). Company switching, tenant isolation, scheduling revision protection and CRM metrics are covered by the regression suites in §13.
