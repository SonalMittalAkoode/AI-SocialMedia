# SocialAI three-step onboarding

## Original workflow audit

The active frontend used one wizard for Business, Brand, Competitors, Content preferences and First post. It stored a step cursor and separate `completed_steps` in PostgreSQL. Business collected a name and other fields alongside a separate Analyze button. Brand used the full settings form. The browser required a saved generated draft before calling the legacy completion API. The setup also carried a local workspace draft with explicit recovery.

Website analysis already ran in a durable PostgreSQL queue. The shared worker fetched public pages, validated redirects and resolved addresses, called the configured provider, and stored evidence and candidate media. The private logo importer already supported normalizing and validating website images and extracting a palette. Content Studio already used the content-generation queue, loaded results separately, and supported Studio editing, draft saves and review. Images were separate jobs tied to the caption result.

Before editing, the development database contained completed and incomplete companies at each of the legacy milestones and retained AI jobs. Alembic was at `09efca8855d4`. The API, frontend and worker were running locally. The active provider was OpenAI with text and image capabilities. The existing Bordeaux, Deep Green and Cream design tokens were used.

## Three steps

1. **Business** accepts one website. The server normalizes and validates it before company creation. Continue saves the company and starts the existing extraction job. The UI displays the current job stage and can recover the existing job after reload. The optional inline manual form collects the name, industry and description. Failed or blocked research keeps the URL and lets the user retry or continue manually.
2. **Brand** shows the saved summary with the logo, palette, audience and core facts. Completed extraction fills available gaps in the unconfirmed draft. A missing logo uses initials. Missing optional fields are labelled. The expanded editor reuses the brand form, exposes research classifications and stages logo edits until Save changes. Confirming uses the existing confirmation rules. A real name and a description of at least ten characters are required.
3. **Goals** asks for one primary goal, selected platforms and a voice. Saved choices take priority. For a new profile, the brand's applicable voice or suggested tone guides the default. Known social links can suggest a destination. Instagram is used when no prior destination is available. Advanced preferences can be edited in Brand Profile after setup.

## Legacy state mapping

| Existing record | Next route |
| --- | --- |
| In progress without a finished business milestone | Business |
| Business finished, brand unconfirmed | Brand |
| Brand already confirmed, including legacy Competitors, Preferences and Generate | Goals |
| Completed onboarding | Dashboard |
| Incoming link to a removed step | Resolves through Goals and resumes at the appropriate available milestone |

The mapping reads existing milestones and confirmation status. Migration performs no data backfill. Legacy API routes remain available. Brand, preferences, extraction results, competitors, job history, posts, files, schedules, and memberships stay in the existing tables. Existing generation history is reused during finalization when a previous first draft already exists. Draft recovery remains explicit. The simplified Brand screen opens recovered data in its editor before a user can save. The server copy is authoritative.

## API and database changes

| Route | Behavior |
| --- | --- |
| `POST /onboarding/validate-website` | Validates and normalizes through the existing public URL rule. Uses the current authenticated session and origin policy. |
| `POST /companies/{company_id}/onboarding/website-brand` | Prepares editable fields from a completed analysis of the company's current URL. Keeps a confirmed brand and existing values. |
| `POST /companies/{company_id}/onboarding/finalize` | Uses progress and preference revisions. Saves the selections, activates the company, completes onboarding, and admits the first content job or records the admission error. |
| `GET /companies/{company_id}/onboarding/first-post` | Reads the company's durable handoff and current retry state. |
| `POST /companies/{company_id}/onboarding/first-post` | Explicitly retries a failed or rejected handoff. Accepts the last observed job ID and can omit images. |
| `GET /companies/{company_id}/onboarding/checklist` | Returns persisted facts for the optional setup checklist. |

Migration `87aa6b6cc390` adds nullable `onboarding_progress.first_post`. It stores a company-scoped job reference or a recoverable admission error. Job content and all images remain in the existing queue and media tables. Company authorization protects every company route. Finalization and retry use the existing company row lock.

## Content Studio handoff

Finalization snapshots the confirmed brand and stored preferences into the standard content request. The first topic introduces the brand using its saved offerings and description. The chosen objective and voice steer the copy. Platform variants use the existing generator and its cap. All selected destinations are saved. The first generation uses the first destinations in selection order up to the configured limit of three by default.

New setups default to a text post and three posts per week. Existing image preferences request separate per-platform image jobs. Content Studio supports editing, saving, regenerating and reviewing the draft with the existing controls. Images can finish or fail independently. The user can skip an in-progress image and continue with the caption.

The handoff and onboarding completion commit atomically when the queue accepts the job. Capacity and provider-configuration failures persist a retry state alongside successful onboarding. Repeated finalization returns the saved handoff without admitting new work. Retry checks the previous job before admission. Browser mounts and reloads read and poll the queue. The first-post link in Studio and on the dashboard uses the current company's saved reference after refresh or sign-in.

## Competitor discovery and checklist

Competitors are optional and available through the existing CRM module. Onboarding creates no competitor jobs. Search suggestions stay display-only and onboarding never stores or crawls them. Approved, independently sourced research remains available through the existing competitor workflow.

The optional dashboard checklist uses server facts for brand confirmation, a saved post, an approved competitor, a connected or limited social account, and a current schedule. Dismissal is stored per account and company in the current browser. The links go to the existing screens.

## Modified file inventory

| Area | Files |
| --- | --- |
| Workflow and queue | `backend/app/api/onboarding.py`, `backend/app/schemas/onboarding.py`, `backend/app/models/onboarding.py`, `backend/app/services/onboarding.py`, `backend/app/services/simplified_onboarding.py`, `backend/app/services/ai_queue.py`, migration `87aa6b6cc390` |
| Onboarding UI and data | `frontend/src/app/onboarding/[step]/page.tsx`, `frontend/src/app/layout.tsx`, `frontend/src/app/onboarding-setup.css`, `frontend/src/components/onboarding.tsx`, `brand-form.tsx`, `company-controls.tsx`, `preferences.tsx`, `ui.tsx`, `frontend/src/lib/company-api.ts`, `company-state.ts`, `storage.ts`, `frontend/src/store/use-company-persistence.ts`, `frontend/src/types/index.ts` |
| Studio and dashboard | `frontend/src/app/dashboard/[section]/page.tsx`, `frontend/src/components/content/studio.tsx`, `real-content.tsx`, `post-media.tsx`, `frontend/src/store/use-ai-job.ts`, `frontend/src/components/dashboard/crm-overview.tsx`, `setup-checklist.tsx` |
| Verification | `backend/tests/test_simplified_onboarding.py`, `backend/scripts/seed_crm_browser_generation.py`, `frontend/tests/e2e/simplified-onboarding.spec.ts`, existing onboarding, auth, competitor, generation and theme regression tests, and company state and storage unit tests |

## Verification

The browser regression uses the running frontend at `http://localhost:3001`. The phase screenshots use controlled test fixtures. Browser coverage exercises the website and manual routes, extraction progress and failure, edits and colours, job restore, image failure with an editable caption, and the checklist. The API tests cover quota recovery, tenant isolation, old jobs and job admission idempotency.

| Check | Result |
| --- | --- |
| Backend pytest | 404 passed |
| Frontend unit tests | 88 passed |
| Playwright at port 3001 | 42 passed in the full run. The five cases that initially failed passed in targeted reruns after fixes. |
| TypeScript and ESLint | Passed |
| Next.js production build | Passed |
| Alembic | Upgrade to `87aa6b6cc390` applied. `alembic check` found no pending schema changes. |

The bounded live test used a separate smoke workspace with one Instagram text request through the real finalize endpoint and the existing OpenAI worker. The job completed with `gpt-6-luna` and returned an editable caption. Duplicate finalization recovered the same job. No image generation was requested. Live website analysis and live image generation for this phase were not part of the smoke test.

## Screenshots

All captures are in [frontend/artifacts/onboarding-3step](../frontend/artifacts/onboarding-3step/).

| Screen | Captures |
| --- | --- |
| Business | [Desktop](../frontend/artifacts/onboarding-3step/step-1-website-desktop.png), [mobile](../frontend/artifacts/onboarding-3step/step-1-website-mobile.png), [manual](../frontend/artifacts/onboarding-3step/step-1-manual.png), [progress](../frontend/artifacts/onboarding-3step/step-1-analysis-progress.png), [research error](../frontend/artifacts/onboarding-3step/step-1-analysis-error.png) |
| Brand | [Desktop](../frontend/artifacts/onboarding-3step/step-2-brand-desktop.png), [mobile](../frontend/artifacts/onboarding-3step/step-2-brand-mobile.png), [editor](../frontend/artifacts/onboarding-3step/step-2-edit-details.png) |
| Goals | [Desktop](../frontend/artifacts/onboarding-3step/step-3-goals-desktop.png), [mobile](../frontend/artifacts/onboarding-3step/step-3-goals-mobile.png) |
| Studio | [Generating](../frontend/artifacts/onboarding-3step/studio-first-post-generating.png), [completed](../frontend/artifacts/onboarding-3step/studio-first-post-completed.png) |
| CRM | [Setup checklist](../frontend/artifacts/onboarding-3step/crm-optional-setup-checklist.png) |

## Remaining limits

Public websites can decline automated access or publish too little information to confirm a profile. In that case the user supplies the missing facts. The brand card reflects the supported evidence and the user still reviews claims in the generated draft. A later session can reopen the first draft through Studio. Social account connections, scheduling and competitor discovery remain separate actions.

