# CRM entry routing

Login now opens `/dashboard` for authenticated users, including accounts with no company and companies with unfinished onboarding. The dashboard still verifies the server session; anonymous, expired and unavailable sessions retain their existing handling.

Company and workspace selection now opens the CRM rather than automatically resuming setup. The Post Library preserves its current section when selecting a company. The workspace selector closes after a successful selection, including mobile navigation.

Onboarding remains an explicit flow. New accounts see **Set up company** in the overview; unfinished companies see **Continue company setup** linking to their saved step. Add company and New workspace still open setup. **Save & exit** returns to the dashboard. Completing onboarding still uses the existing validated server requests.

This change does not mark onboarding complete, confirm brands, modify database records on login, or relax generation, approval or scheduling validation. No backend or migration change is required.

Browser coverage includes a fresh account entering the dashboard before explicitly starting onboarding, incomplete-company login and deep-link reload, unchanged onboarding progress during CRM navigation, explicit setup resumption, setup exit, desktop/mobile company switching, existing content persistence and session protection.

The browser fixture now seeds the selected company only when no selection exists, so page reloads exercise real persisted company selection. The brand-save regression waits for the actual save response, since remaining on the same CRM URL no longer provides an implicit wait for completion.

Validation: TypeScript, ESLint and all 44 frontend unit tests passed. All 20 distinct browser scenarios in auth, company, CRM, journey and scheduling passed across the regression runs and focused rechecks. The initial selector-dialog and outdated redirect assertions were corrected; the final brand-save timing correction passed its focused recheck. Scheduling coverage includes the live shared worker transition to Awaiting Publisher. Backend source, database schema and environment configuration were not changed.
