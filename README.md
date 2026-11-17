# SocialAI

A responsive social media SaaS prototype with real FastAPI/PostgreSQL authentication, company onboarding, website research, Gemini brand extraction, and a Next.js frontend. Automated independent competitor research, Gemini text and image generation, a persistent Post Library and real scheduling are implemented (see [competitor intelligence](docs/competitor-intelligence.md), [AI content generation](docs/ai-content-generation.md) and [CRM dashboard](docs/crm-dashboard.md)). Social account connections, publishing and engagement analytics are not connected yet. The existing UI uses strict TypeScript, Tailwind CSS, Radix/shadcn-style primitives, Lucide, Motion, React Hook Form + Zod, and Recharts.

See [authentication integration](docs/authentication.md) for the audit, configuration, security requirements, testing, and complete file inventory.

See [company onboarding](docs/company-onboarding.md) for the database architecture, tenant authorization, APIs, draft recovery, and Phase 3 file inventory. Apply migrations with `.\.venv\Scripts\python.exe -m alembic upgrade head` from `backend/` before starting the API.

See [real brand extraction](docs/brand-extraction.md) for Phase 4 architecture, security controls, API contracts, exact file inventory, tests, and limitations. Real research requires an additional backend terminal running `.\.venv\Scripts\python.exe -m app.workers.extraction` and the existing private Gemini configuration. The API queues durable jobs; it does not launch the worker automatically.

## Run locally

Requires Node.js 22.12+, 24+, or 26+ and npm (including the test tooling).

```sh
cd frontend
npm install
npm run dev
```

Start the existing PostgreSQL and backend services in separate terminals:

```powershell
# From the repository root; uses existing environment files and volumes.
docker compose up -d postgres pgadmin
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://localhost:3000. **Get started** registers an account, then redirects to login. **Explore the dashboard** requires a valid server session and completed onboarding. The frontend API defaults to `http://localhost:8000/api/v1` and can be configured with `NEXT_PUBLIC_API_URL`. Keep browser/API hostnames consistent for SameSite cookies.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
npx playwright test
```

Run frontend commands from `frontend/`. Browser tests reuse a running frontend or start the production server on port 3000; they require the backend and PostgreSQL. Install Chromium with `npx playwright install chromium` if unavailable. Screenshots are written to `frontend/artifacts/`. Backend tests: from `backend/`, install `requirements-dev.txt`, then run `.\.venv\Scripts\python.exe -m pytest tests -q`.

## Demo guide

- Sign up with a name, valid email, and matching password of 12–128 characters including a letter and number. Argon2 password hashes are saved in PostgreSQL. Login verifies the account and sets a 30-minute HttpOnly JWT cookie. Tokens/passwords are never stored in localStorage or sessionStorage. `/auth/me` restores the session; login resumes the selected server-backed company.
- Onboarding has five persistent steps. Enter a real public business website to research it with Gemini, review evidence, edit and select findings, then explicitly apply and confirm them. Failed research never generates fictional findings. Manual entry remains available; fictional `.example` URLs cannot be researched.
- Choose fictional competitors, platforms, goals, formats, tone, language, and frequency. Generate three controlled sample templates; edit and save a draft to finish onboarding.
- Content Studio offers a simulated-error toggle to demonstrate failure and retry. Templates reflect brand, platform, topic, format, language, and selected tone where supported. Instructions and guidelines remain editorial context and require manual review.
- My Posts supports search, filters, grid/list views, editing, duplication, confirmation before deletion, and simulated status changes. The calendar stores planned local date/time strings, with month and week views. No post is sent anywhere.
- Brand edits affect workspace labels and future templates. Logo previews (PNG/JPEG/WebP, up to 300 KB) remain local. Creative downloads are standalone SVG designs. Multi-frame carousels, memes, videos, and generated photography are not rendered; format choices label editable template drafts.
- Settings includes local profile preview, workspace, notification preferences, real logout, and mock-data reset confirmation. Reset does not delete the account. Dark appearance is fixed. Analytics trends/engagement and competitor strategies are clearly illustrative; post counts and platform distribution reflect local saved content.
- Account connection opens an explanation of future integrations. Password reset acknowledges the demo request and sends no email. Pricing and legal copy are placeholders.

## Architecture

- `frontend/src/app/`: marketing, real auth forms, five onboarding routes, and all nine dashboard screens.
- `src/components/`: shared UI, layouts, brand and preference editors, competitor management, content generation/preview/editor, calendar, analytics, and settings.
- `src/types/`, `src/data/`: workspace-oriented models and deterministic fixtures.
- `src/lib/`: isolated promise-based mock API, validation, versioned storage serialization, onboarding route resolution.
- `src/store/provider.tsx` and `use-company-persistence.ts`: verified session bootstrap, server-backed company state, scoped local mock drafts, and toast feedback.
- `tests/`: unit checks for persistence, validation, templates, scheduling, and end-to-end browser journeys.

Company, brand, preferences, and onboarding progress restore from PostgreSQL after verified login. Workspace/company selection is checked against server memberships. Local mock posts, competitors, logo previews, and unsaved drafts use `socialai-company-draft:<verified-user-ID>:<company-ID>`. Legacy caches are preserved and require explicit recovery and review before saving. Storage failures show a session-only warning. Avoid sensitive content in browser storage; only backend cookie validation establishes authentication.

## Future backend work

Authentication, tenant-authorized company onboarding, and reviewed website/Gemini research use the existing FastAPI/PostgreSQL backend. Remaining work includes production rate limiting, server-side session revocation, HTTPS deployment hardening, email verification/reset, invitations, real competitor discovery, content generation, OAuth, scheduling/publishing, measured analytics, billing, and reviewed legal policies. Clearing a stateless cookie does not revoke a stolen JWT. See the authentication document for production blockers.
