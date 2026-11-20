# SocialAI premium CRM Overview

## Baseline audit

The previous Overview rendered ten KPI cards, then eight panels for recent posts, scheduling, approval, activity, generation history, workspace actions, AI reporting and competitor statistics. The global header, page header and shortcuts repeated the creation action. The checklist came first and showed five rows by default. Its unstyled heading inside a generic flex row used cramped inherited typography at mobile widths. The recent-content table clipped its last column at 375 px, and dashed empty states used more space than the content required.

The breadcrumb read the workspace name while the switch control read the company display name. The persistence hook also exposed the next company ID before the new company profile had loaded. The CRM summary already returned PostgreSQL post counts, confirmed AI result counts and calendar rows. The legacy Scheduled count included overdue rows that still had scheduled status, and the existing upcoming list excluded future blocked plans.

The working tree already contained changes from earlier phases. The fresh baseline passed 88 frontend unit tests and the existing CRM browser test at port 3001. The baseline screenshots measured 1440 × 2100 and 375 × 4115.

## New information architecture

1. **Your creative workspace** names the active company and presents one Create Post action in the Overview heading. The global action stays available on the other CRM screens.
2. **Four KPI cards** present the saved content total, review workload, active upcoming plans and AI output.
3. **AI Content Studio hero** opens an editable brief. Its input is optional.
4. **Recent Posts** shows four saved records at most, with authenticated thumbnail URLs, an icon for unavailable thumbnails, platform, status, and updated date. Each row opens the existing Post Library editor.
5. **Upcoming Schedule** shows up to three future active calendar rows in chronological order. The row opens the existing Calendar detail. The dashboard uses the company timezone even when the browser uses another.
6. **Setup checklist** is collapsed below the main content. It reads the existing persisted checks, displays progress and offers task links. It hides when all checks pass. Dismissal is stored per user and company in the current browser. Unfinished onboarding has a compact resume link.

Approval filters and media remain in Post Library. Scheduling activity and operational states remain in Calendar. AI job and result details remain in Generation History and Content Studio. Competitor detail remains in Competitor Intelligence. Social connection and integration information remain in the dedicated screens.

## Data and behavior

| Metric or panel | Data source and meaning |
| --- | --- |
| Total Posts | `total_posts` in the company summary. Counts all saved posts, including archived records. |
| Needs Attention | `draft_posts + ready_for_review_posts`. Statuses are mutually exclusive. Archived and approved posts are outside this workload. |
| Scheduled | `upcoming_scheduled_posts`. Distinct post IDs with at least one future `scheduled`, `blocked`, or `awaiting_publisher` row. The same time cutoff drives the list. Earlier dates and cancelled or failed rows are excluded from this metric. Historical states remain visible in Calendar. |
| AI Creations | `content_stats.generated_posts`. Counts individual results in completed content-generation jobs, including unsaved results and multiple platforms within a job. |
| Recent Posts | Latest four records from the existing Post Library projection, ordered by update time. It provides the chosen image, its existing fallback to the latest stored asset, and a representative schedule. |
| Upcoming Schedule | `upcoming_active_schedules`, a bounded calendar projection sorted by instant and ID. It displays the stored status and formats dates and times in the company's configured timezone. |

The summary response adds two read-only fields. The previous fields, endpoints, timezone setting, approvals, scheduler transitions and tenant checks keep their existing contracts. The change needs no database migration. The Overview and breadcrumb use the same selected company profile. Selecting another company shows loading until the new selection is ready, then remounts account-specific reads and clears the previous company’s in-progress hero text.

The hero opens Content Studio's new-brief route with an optional topic of up to 500 characters. The query carries the company ID so Studio can discard a mismatched prefill. The topic is editable and survives refresh on the same URL. Navigating or prefilling does not submit a generation request. Users initiate generation in the existing Studio form. The topic is part of the Studio URL while using this direct handoff.

## Visual design and responsive layout

The dashboard uses the existing Bordeaux, Deep Green and Cream tokens, with ivory cards, warm borders and Lucide icons. The hero's abstract detail uses CSS and one icon. The checklist has its own compact grid, a wrapped heading, and accessible expansion and dismissal controls. Spacious section gaps are paired with compact rows and empty states.

The KPI grid uses four columns at 1440 and 1920 px, and two at 1024, 768, 390 and 375 px. Posts and schedules sit side by side on desktop and stack on narrow layouts. The browser tests check all six widths for horizontal overflow. Counts use an unavailable state while data is loading or has yet to arrive.

## Modified files

- Backend read projection and response schema: `backend/app/services/crm.py`, `backend/app/services/scheduling.py`, `backend/app/schemas/crm.py`.
- Frontend layout and Overview styling: `frontend/src/app/layout.tsx`, `frontend/src/app/dashboard-overview.css`, `frontend/src/components/dashboard/crm-overview.tsx`, `frontend/src/components/dashboard/crm-ui.tsx`, `frontend/src/components/dashboard/setup-checklist.tsx`, `frontend/src/components/dashboard/shell.tsx`.
- Company selection, response parsing and Studio prefill: `frontend/src/store/use-company-persistence.ts`, `frontend/src/lib/crm-api.ts`, `frontend/src/app/dashboard/[section]/page.tsx`, `frontend/src/components/content/studio.tsx`, `frontend/src/components/content/real-content.tsx`.
- Regression tests: `backend/tests/test_crm_dashboard_stats.py`, `frontend/tests/e2e/crm-dashboard.spec.ts`, `frontend/tests/e2e/crm.spec.ts`, `frontend/tests/e2e/auth.spec.ts`, `frontend/tests/e2e/journey.spec.ts`, `frontend/tests/e2e/competitor-research.spec.ts`, `frontend/tests/e2e/social-accounts.spec.ts`, `frontend/tests/e2e/simplified-onboarding.spec.ts`.
- Handoff and captures: `docs/premium-dashboard-redesign.md`, `frontend/artifacts/dashboard-redesign/`.

## Screenshot comparison

The captures use isolated browser test companies and stored posts and schedules. The representative populated Overview measures 1068 px tall at 1440 px and 1408 px tall at 375 px, down from 2100 px and 4115 px in the baseline captures. The mobile content and checklist headings fit without clipping.

| View | Desktop | Mobile |
| --- | --- | --- |
| Before | [Dashboard](../frontend/artifacts/dashboard-redesign/before-desktop.png) | [Dashboard](../frontend/artifacts/dashboard-redesign/before-mobile.png) |
| Populated | [Dashboard](../frontend/artifacts/dashboard-redesign/populated-desktop.png) | [Dashboard](../frontend/artifacts/dashboard-redesign/populated-mobile.png) |
| Empty | [Dashboard](../frontend/artifacts/dashboard-redesign/empty-desktop.png) | [Dashboard](../frontend/artifacts/dashboard-redesign/empty-mobile.png) |
| AI hero | [Hero](../frontend/artifacts/dashboard-redesign/creation-hero.png) | [Hero](../frontend/artifacts/dashboard-redesign/creation-hero-mobile.png) |
| Posts and calendar | [Panels](../frontend/artifacts/dashboard-redesign/recent-and-schedule.png) | [Panels](../frontend/artifacts/dashboard-redesign/recent-and-schedule-mobile.png) |
| Setup | [Expanded checklist](../frontend/artifacts/dashboard-redesign/checklist.png) | [Expanded checklist](../frontend/artifacts/dashboard-redesign/checklist-mobile.png) |
| After switching | [Second company](../frontend/artifacts/dashboard-redesign/after-switch-desktop.png) | [Second company](../frontend/artifacts/dashboard-redesign/empty-mobile.png) |

## Verification

| Check | Result |
| --- | --- |
| Frontend unit suite | 88 passed |
| Backend CRM and scheduling regressions | 65 passed, including the additive projection, ordering, exclusions, and tenant access |
| Playwright against port 3001 | 29 passed in the main run and one additional competitor-navigation case passed separately |
| TypeScript and ESLint | Passed |
| Next.js production build | Passed |

Browser checks covered the selected company and breadcrumb, delayed company switching, thumbnails and deep links, the New York schedule displayed in a browser configured for Kolkata, brief prefill and refresh, checklist dismissal, responsive layout, and existing onboarding and account flows. The creation-hero test observed zero generation requests during navigation and prefill. Browser generation scenarios used fixtures. This phase made zero paid AI calls.

## Remaining limits

Checklist dismissal is browser-local. This Overview shows the latest four posts and next three schedule entries. Calendars and Post Library provide the wider history. Publishing and engagement analytics remain outside the scope of the Overview.

