# SocialAI

A responsive, frontend-only social media SaaS demo built with Next.js App Router, strict TypeScript, Tailwind CSS, Radix/shadcn-style UI primitives, Lucide, Motion, React Hook Form + Zod, and Recharts.

## Run locally

Requires Node.js 22.12+, 24+, or 26+ and npm (including the test tooling).

```sh
npm install
npm run dev
```

Open http://localhost:3000. Choose **Get started** for the full onboarding journey or **Explore the dashboard** for a populated demo.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
npx playwright test
```

Browser tests run against a production server on port 3000 (started automatically if needed). Install Chromium with `npx playwright install chromium` if it is unavailable. Screenshots are written to `artifacts/`.

## Demo guide

- Sign up with a name, valid email, and matching password of 8+ characters. Passwords are validated in memory and never persisted. Login accepts any valid-looking details; the same email resumes this browser’s workspace.
- Onboarding has five persistent steps. Use the fictional `https://brewandbean.example` profile, enter any other URL for an editable illustrative profile, or enter details manually. No URL is fetched.
- Choose fictional competitors, platforms, goals, formats, tone, language, and frequency. Generate three controlled sample templates; edit and save a draft to finish onboarding.
- Content Studio offers a simulated-error toggle to demonstrate failure and retry. Templates reflect brand, platform, topic, format, language, and selected tone where supported. Instructions and guidelines remain editorial context and require manual review.
- My Posts supports search, filters, grid/list views, editing, duplication, confirmation before deletion, and simulated status changes. The calendar stores planned local date/time strings, with month and week views. No post is sent anywhere.
- Brand edits affect workspace labels and future templates. Logo previews (PNG/JPEG/WebP, up to 300 KB) remain local. Creative downloads are standalone SVG designs. Multi-frame carousels, memes, videos, and generated photography are not rendered; format choices label editable template drafts.
- Settings includes profile, workspace, notification preferences, logout, and destructive reset confirmation. Dark appearance is fixed. Analytics trends/engagement and competitor strategies are clearly illustrative; post counts and platform distribution reflect local saved content.
- Account connection opens an explanation of future integrations. Password reset acknowledges the demo request and sends no email. Pricing and legal copy are placeholders.

## Architecture

- `src/app/`: marketing, demo auth, five onboarding routes, and all nine dashboard screens.
- `src/components/`: shared UI, layouts, brand and preference editors, competitor management, content generation/preview/editor, calendar, analytics, and settings.
- `src/types/`, `src/data/`: workspace-oriented models and deterministic fixtures.
- `src/lib/`: isolated promise-based mock API, validation, versioned storage serialization, onboarding route resolution.
- `src/store/provider.tsx`: single shared client-side workspace with hydration-safe local persistence and toast feedback.
- `tests/`: unit checks for persistence, validation, templates, scheduling, and end-to-end browser journeys.

The app stores one demo profile and one workspace under `socialai-demo-v1`. Corrupt/unsupported state falls back to initial fixtures. Storage failures show a session-only warning. Avoid sensitive information in this demo; localStorage is not secure authentication or a production database.

## Future backend work

Replace the mock service boundary with FastAPI requests; add secure authentication and reset email, authorization, server-side persistence, real brand/competitor analysis, AI content and asset generation, approved OAuth integrations, backend scheduling/publishing, measured analytics, billing, and reviewed legal policies. No backend, database, AI, OAuth, or publishing integration is implemented here by design.
