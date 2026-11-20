# SocialAI Phase 7.7 · Competitor Intelligence

The CRM workspace and onboarding Step 03 share the competitor components and existing authenticated APIs. The workspace uses four tabs in the CRM and two in onboarding. The watchlist, evidence, research history, permission checks, soft removal, and eligibility for Content Studio use persisted company data.

## Checkpoints

| Phase | Result |
| --- | --- |
| A · Audit | Reviewed the existing components, APIs, services, models, and competitor, CRM, and onboarding documentation. The prior redesign already supplied the visual system, Markdown renderer, watchlist actions, shared drawer, and onboarding integration. The primary gaps were first-page limits, incomplete filters and controls, queue detail, and a client-side approximation of AI eligibility. The initial frontend suite passed 71 tests. |
| B · Layout | Added the specified header and company context. Four KPI cards and tab counts use the company’s real records. The browser remembers the selected tab per company and per workspace variant. |
| C · Grounded discovery | Kept the existing safe React Markdown renderer, inline citations at their original offsets, Sources, attribution, and sandboxed Google Search Suggestions. Added the reference-only message and an explicit rerun action. The answer lives only in component memory. |
| D · Competitor cards | Added keyboard-accessible score help, readable status labels and card names, and the missing menu actions. Existing records and research supply every value. Initials are used because competitor research currently supplies no securely stored logo. |
| E · Watchlist | All pages are read before search, ranges, sorting, and 12-record display pagination. Filters include independent approval and removal state. Grid and table share the filtered data and selection. Bulk submission respects the server limit. |
| F · Research drawer | Preserved all six sections and evidence. Historical versions are selected by ID. Escape closes the drawer and returns keyboard focus. Verification labels require supporting evidence, and the sticky actions follow the server’s permissions. |
| G · Queue | Real queued, researching, completed, and failed counts, requested and finished timestamps, stored worker stages, failures, cancellation, retry, and batch progress. A batch bar counts completed, failed, and cancelled jobs as finished. |
| H · Approved insights | Content Studio eligibility uses the same backend function as generation. Eligible insights, evidence, and verification limitations are available from the tab. The CTA opens Content Studio for the active company. Opening the studio starts no generation. |
| I · Onboarding | Reuses discovery, cards, status, and the details drawer in a two-tab layout. Back to brand identity, Skip for now, and Continue to preferences preserve optional research. |
| J · Interaction states | Includes the supplied empty and failure messages, skeleton cards, request feedback, duplicate-request guards, quota error handling, keyboard score help, and removal confirmation. |
| K · Verification | See the test results and screenshot matrix below. |

## API and data

- `GET /api/v1/companies/{company_id}/ai-capabilities` adds `can_manage_competitors`, `max_approved_competitors`, `max_bulk_research`, and `content_eligible_competitor_ids`. Existing keys and response types are retained. All fields are scoped to the authenticated company. Member users can read company research, while mutations require an owner or admin.
- `GET /api/v1/companies/{company_id}/ai-jobs` adds the job ID as the stable tie-breaker for creation time. The watchlist uses existing limit and offset parameters on competitors, insights, and research jobs.
- This phase adds no schema change or migration. The previously pending office-address migration was applied only when preparing the isolated QA schema. `.env` and existing research records were left intact.

## Verification

- Backend pytest passed all 291 tests. Frontend Vitest passed all 71 tests. TypeScript, ESLint, production build, and `alembic check` passed.
- The complete browser suite passed all 37 tests before the final layout refinements. The final full run passed 36 tests and exposed a fixture setup that exceeded the browser’s request timeout. Moving fixture setup ahead of the request made the onboarding regression pass on rerun. All three competitor tests then passed with the final tablet queue layout and screenshot checks.
- One live Gemini grounding request returned 6 sources, 17 citation spans, and Google Search Suggestions. Only these counts were retained. Browser screenshots use the mocked grounded answer and labelled test research fixtures.
- Row counts and ordered row-content hashes matched before and after verification for 60 competitors, 13 research results, and 92 AI jobs in the application database. The verification suites used an isolated PostgreSQL database.
- The visual checks cover 1920, 1440, 1024, 768, 390, and 375 px. The screenshot sets use 1440, 768, and 390 px. The watchlist checks grid and contained table scrolling. The drawer test checks Escape, focus restoration, and full width at 375 px.

### Screenshots

| View | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Discover | [1440 px](../frontend/artifacts/phase-7.7/discover-desktop.png) | [768 px](../frontend/artifacts/phase-7.7/discover-tablet.png) | [390 px](../frontend/artifacts/phase-7.7/discover-mobile.png) |
| My Competitors | [1440 px](../frontend/artifacts/phase-7.7/my-competitors-desktop.png) | [768 px](../frontend/artifacts/phase-7.7/my-competitors-tablet.png) | [390 px](../frontend/artifacts/phase-7.7/my-competitors-mobile.png) |
| Research Queue | [1440 px](../frontend/artifacts/phase-7.7/research-queue-desktop.png) | [768 px](../frontend/artifacts/phase-7.7/research-queue-tablet.png) | [390 px](../frontend/artifacts/phase-7.7/research-queue-mobile.png) |
| Approved Insights | [1440 px](../frontend/artifacts/phase-7.7/approved-insights-desktop.png) | [768 px](../frontend/artifacts/phase-7.7/approved-insights-tablet.png) | [390 px](../frontend/artifacts/phase-7.7/approved-insights-mobile.png) |
| Onboarding discovery | [1440 px](../frontend/artifacts/phase-7.7/onboarding-discover-desktop.png) | [768 px](../frontend/artifacts/phase-7.7/onboarding-discover-tablet.png) | [390 px](../frontend/artifacts/phase-7.7/onboarding-discover-mobile.png) |
| Details drawer | [1440 px](../frontend/artifacts/phase-7.7/details-drawer-desktop.png) | [768 px](../frontend/artifacts/phase-7.7/details-drawer-tablet.png) | [390 px](../frontend/artifacts/phase-7.7/details-drawer-mobile.png) |

## Modified-file inventory

- `backend/app/api/intelligence.py`
- `backend/tests/test_competitor_research_automation.py`
- `frontend/playwright.config.ts`
- `frontend/src/app/competitors.css`
- `frontend/src/components/competitors/dialogs.tsx`
- `frontend/src/components/competitors/discover.tsx`
- `frontend/src/components/competitors/drawer.tsx`
- `frontend/src/components/competitors/my-competitors.tsx`
- `frontend/src/components/competitors/queue-and-insights.tsx`
- `frontend/src/components/competitors/shared.tsx`
- `frontend/src/components/competitors/use-competitor-data.ts`
- `frontend/src/components/competitors/workspace.tsx`
- `frontend/src/components/onboarding.tsx`
- `frontend/tests/e2e/competitor-research.spec.ts`
- `frontend/tests/e2e/crm-dashboard.spec.ts`
- `frontend/tests/e2e/intelligence.spec.ts`
- `frontend/tests/e2e/journey.spec.ts`
- `docs/competitor-ui-redesign.md`

## Limitations

- Existing competitor research does not retain validated logo assets. The UI uses initials and makes no external logo requests.
- Search and sorting read bounded API pages and filter the collected company records in the browser. Very large histories can take additional requests.
- Reused jobs retain their original batch IDs. Queue progress reflects stored membership, and older terminal jobs are available with **Show more research**.
- Grounded results are ephemeral and provider availability can vary. Independent research remains available under its existing role and quota rules.
