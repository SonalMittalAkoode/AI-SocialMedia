# SocialAI colour palette update: Bordeaux, Deep Green and Cream

**Status:** implemented and verified on the SocialAI dev server (`http://localhost:3001`), 2026-11-20.
**Scope:** the SocialAI application's own theme only. This was a visual change: no functionality, API, data model, route or workflow changed.

## 1. Summary

The SocialAI interface used a dark theme: Jet Black `#0B0B0B` backgrounds, Hot Pink `#FF2DAB` actions and Chartreuse `#D4EE3E` accents. It now uses a light, warm palette:

| Role | Colour | Where it appears |
|---|---|---|
| Bordeaux `#6C151E` | Primary | Primary buttons, headings, accent text, links, selected navigation, focus ring, today's date, progress fills |
| Deep Green `#0F3D3A` | Secondary | Sidebar, promotional panels (login art and final call to action), secondary buttons, body text, toasts and tooltips |
| Cream `#F5DABF` | Background | Page background; text on Bordeaux and Deep Green |

Cards use lighter ivory tones derived from Cream. Status colours (success, warning, error, info) remain separate hues so they keep their meaning.

## 2. Audit findings (before)

- **Five stylesheets, about 9,000 lines** (`globals.css`, `crm.css`, `competitors.css`, `content-quality.css`, `social-accounts.css`). They contained **about 740 hardcoded colour values** (373 unique) and only 8 shared variables (`--bg`, `--card`, `--elevated`, `--border`, `--pink`, `--lime`, `--muted`, `--dim`), plus a separate `--cx-*` set for Competitor Intelligence.
- **Tailwind v4 is installed**, but no UI uses Tailwind colour utilities. Styling is class-based CSS. The `@theme` block held four literal colours.
- **Theme colours in TSX:** only `components/dashboard/charts.tsx` (Recharts colours). These components are not currently imported by any page, but they were themed for when they are.
- **Colours that are not app chrome and were deliberately left alone:**
  - customer brand palettes and the brand colour editor (`brand-form.tsx`);
  - the demo creative SVG (`post-card.tsx`);
  - fixture brand colours (`data/fixtures.ts`);
  - the neutral backdrop behind uploaded logos (`brand-logo.tsx`);
  - the illustrative coffee artwork on the landing and login pages (`.creative`, `.coffee-*`, `.bean-*`, `.tiny-avatars`, `.mini-art`);
  - competitor initials avatars (their colour comes from the record);
  - Google's grounding-suggestions iframe, which must keep its white background.

## 3. Design tokens

All theme colours are defined once, in `:root` in `frontend/src/app/globals.css`. Components reference tokens only. Tailwind's `@theme inline` maps its colour names to the same variables.

### Light surfaces (default)

| Token | Value | Use |
|---|---|---|
| `--background` | `#F5DABF` (Cream) | Page |
| `--card` / `--card-foreground` | `#FBEDDD` / Deep Green | Cards, panels, headers |
| `--surface` | `#FEF6EC` | Raised items inside cards: chips, rows, nested boxes |
| `--surface-hover` | `#F0D5B9` | Hover and selected neutral states |
| `--muted` | `#EFD2B4` | Tonal fills: neutral badges, archived and disconnected states, skeletons |
| `--input` | `#FFFAF4` | Form fields |
| `--overlay` | Deep Green at 55% | Modal and drawer backdrops |
| `--foreground` | `#0F3D3A` (Deep Green) | Body text |
| `--foreground-soft` / `--muted-foreground` / `--subtle-foreground` | `#24504C` / `#3F5F5A` / `#48605B` | Secondary, muted and helper text, all AA on every light surface |
| `--heading` | Bordeaux | `h1`–`h3` |
| `--primary` / `--primary-hover` / `--primary-foreground` | `#6C151E` / `#82222C` / Cream | Primary actions |
| `--primary-text` | Bordeaux | Links and accent text |
| `--secondary` / `--secondary-hover` / `--secondary-foreground` | `#0F3D3A` / `#185550` / Cream | Secondary actions |
| `--accent` | `#1A5C53` | Decorative icon and eyebrow accents (formerly chartreuse) |
| `--border` / `--border-strong` | `#E2C3A3` / `#C9A583` | Dividers, card and control borders |
| `--ring` | Bordeaux | Focus outlines and input focus |
| `--success` · `--warning` · `--danger` · `--info` · `--purple` (each with a `-text` token) | `#2B6430` · `#9A6200`/`#7A4B00` · `#B3261E`/`#A3271C` · `#1D4E89` · `#5A3A99` | Status badges, notices, validation |
| `--chart-1…4`, `--chart-grid`, `--chart-axis` | Bordeaux, Deep Green, `#B4703A`, `#5F7F9E` | Charts |

Translucent tints such as badge backgrounds and selected-card washes use `color-mix(in srgb, var(--token) N%, transparent)`, so they follow the token.

### Deep Green surfaces

The sidebar (and the landing page's sidebar preview), the login/signup art panel, the final call to action, toasts and tooltips redefine the same tokens for a dark background:
- cream text and headings;
- `--primary-text` becomes a light rose (`#F2C2BD`);
- the secondary button inverts to Cream with Deep Green text;
- status text uses lighter tints.

A `.theme-dark` utility class applies the same scope to any future panel.

### Legacy names

- `var(--pink)` became `--primary`.
- `var(--bg)` became `--background`.
- `var(--elevated)` became `--card`.
- `var(--muted)` (which held a text colour) became `--muted-foreground`.
- `var(--dim)` became `--subtle-foreground`.
- `var(--lime)` became `--success` where it signals success (badges, completion checks, done steps, success dots, password strength) and `--accent` everywhere else.
- Competitor Intelligence's `--cx-*` variables are now aliases of the global tokens.

## 4. How the conversion was done

A property-aware script converted each colour. It looked at:
- the CSS property: text, background, border or shadow;
- the colour family: neutral, pink, lime, gold, red, blue or purple;
- the luminance;
- the selector: hover and selected states, headings, and text on accent fills.

Two examples:
- a dark neutral background became a card or surface token;
- dark text on a pink button became `--primary-foreground`.

After the script ran, I reviewed and adjusted by hand:
- the sidebar and its selected state (Bordeaux fill with a cream indicator bar, so selection doesn't rely on colour alone);
- the three button tiers;
- input focus rings;
- avatars;
- skeleton shimmer;
- archived and disconnected status pills;
- dark-scope panels;
- charts.

No layout, spacing, radius, typography, markup or class names changed.

### Button hierarchy

| Tier | Class | Appearance |
|---|---|---|
| Primary | `.button-primary` | Bordeaux, Cream text; hover `#82222C` |
| Secondary | `.button-secondary` | Deep Green, Cream text; hover `#185550` |
| Tertiary | `.button-ghost` | Transparent or Cream, Bordeaux text; Bordeaux outline on hover |
| Destructive | `.button-danger` | Red tint, red text (kept distinct from Bordeaux) |

## 5. Modified frontend files

| File | Change |
|---|---|
| `frontend/src/app/globals.css` | New token system; colour values converted to tokens; base inputs, focus ring, headings, buttons, sidebar, avatars |
| `frontend/src/app/crm.css` | Colours converted to tokens; dashboard sidebar background and active item |
| `frontend/src/app/competitors.css` | `--cx-*` aliased to global tokens; colours converted to tokens; skeleton shimmer |
| `frontend/src/app/content-quality.css` | Colours converted to tokens |
| `frontend/src/app/social-accounts.css` | Colours converted to tokens; disconnected status fill |
| `frontend/src/components/dashboard/charts.tsx` | Chart series, grid, axis and tooltip colours use tokens |
| `frontend/tests/e2e/theme-visual.spec.ts` (new) | Screenshots of every screen at three sizes; WCAG AA contrast scan; palette assertions |

`frontend/tests/e2e/content-quality.spec.ts` also changed by one line. Its `getByText("Company")` also matched the hint "This company has no authorized social feed…", which appears only when a company has no connected feed. The locator is now `{ exact: true }`. This was not caused by the theme, but it failed in the first full run, so I fixed it before the clean run.

Nothing else in `src/` changed. After the change, the only hex values left in the stylesheets are the token definitions and the excluded artwork and customer-colour rules listed in section 2.

## 6. Verification

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Pass |
| ESLint | Pass |
| Frontend unit tests (vitest) | 84 / 84 passed |
| Production build (`next build`) | Pass |
| Theme visual spec | 2 / 2 passed: palette assertions, and **0 contrast failures across 20 screens and states** |
| Full browser regression (`:3001`) | **46 / 46 passed in one run** (11.5 min): the 44 existing tests plus the 2 new theme tests |

**Contrast scan.** For every visible text node, the scan measures the text colour against the nearest opaque background behind it and requires WCAG AA: 4.5:1, or 3:1 for large text. Text over images or gradients is skipped, as is disabled text and illustrative artwork. Token contrast on Cream:
- body text 8.96:1;
- muted text 5.2:1;
- Bordeaux 8.88:1;
- Cream on Bordeaux 8.88:1;
- Cream on Deep Green 8.96:1;
- status text 5.3–6.3:1.

**Responsive.** The landing page, onboarding, overview, competitors, studio, post library and calendar were captured at 1440, 820 and 390 px wide. The spec asserts there is no horizontal scrolling at 820 and 390 px. A screenshot of the open mobile sidebar is included.

## 7. Screenshots

Location: `frontend/artifacts/theme-redesign/`
- `*.png`: after, desktop at 1440 px.
- `*-tablet.png` and `*-mobile.png`: after, at 820 and 390 px.
- `before/`: the same screens in the previous theme.
- `comparison/*-before-after.png`: side-by-side sheets for the overview, landing, Content Studio, Competitor Intelligence, Post Library, Calendar, onboarding brand step and login.
- `state-*.png`: an interaction state (the Studio with the topic field focused) and the calendar's "Plan a post" dialog.
- `contrast-report.json`: per-screen contrast results.

Screenshots use a disposable test workspace seeded through the real API: three posts (one with an uploaded image), one scheduled post and two competitor records. The small round "N" badge in the corner of some captures is the Next.js development indicator, not part of the app.

## 8. Preservation

- **Backend and data:** no backend code, endpoints, migrations, AI prompts, models or image-generation logic changed. No backend file was modified during this work.
- **Database:** no reset or deletion. The only rows added are the theme spec's disposable test users and workspaces, which the existing browser tests also create.
- **Customer branding:** brand palettes, logos, generated or uploaded post images and illustrative artwork keep their own colours. The palette editor still shows the customer's HEX values unchanged.
- **Untouched:** routes, navigation behaviour, component names, authentication, roles, approval and scheduling logic, LinkedIn OAuth and `.env` files.
- Nothing was committed.

## 9. Notes and follow-ups

- **The sidebar ends at the viewport height in full-page screenshots.** It is `position: fixed` at viewport height, so this is a property of full-page captures, not something the theme changed. The same is true of modal overlays in full-page captures.
- **Disabled buttons keep the existing 50% opacity rule.** A disabled Bordeaux button reads as muted rose, the same convention as before.
- **New UI should use the tokens in section 3, not literal colours.** For a new dark panel, add the `theme-dark` class.
