# Authentication integration

## Audit and scope

The existing FastAPI auth router, SQLAlchemy sessions, User model, Argon2 password hashing, PyJWT, React Context, forms, guards, and mock content workflows were reused. The existing PostgreSQL `users` table has `id`, `full_name`, `email`, `hashed_password`, `is_active`, `is_verified`, `created_at`, and `updated_at`, with a unique email index. Alembic is at `148ca6c35a66` (head); no schema or migration changes were necessary.

The preexisting uncommitted initialization fix in `backend/app/main.py` was preserved. No `.env` file, database volume, existing user, migration history, dataset, layout, or brand color was replaced.

Missing pieces were frontend cookie-session integration, removal of localStorage authentication trust, consistent logout paths, password-strength validation, duplicate-commit handling, mandatory JWT claims, safe auth error responses, and configurable origins/cookie security. `localhost` and `127.0.0.1` are different browser sites; use the same hostname for frontend and API so SameSite=Lax works.

## Final flow

1. Signup posts `{full_name, email, password}` to `/api/v1/auth/register`. The server normalizes email, validates the name and a 12–128-character password with a letter and number, hashes with Argon2, and commits to PostgreSQL. Registration returns safe fields and `is_verified: false`; it does not create a session. The form redirects to login.
2. Login posts email, password, and optional `remember_me` (default `true`). Invalid credentials receive the same generic response. A disabled account is rejected after password verification. The server sets the signed 30-minute HS256 access JWT in an HttpOnly, SameSite=Lax, Path=/ cookie. JavaScript never receives the token in a response body.
3. The frontend confirms the cookie with `/auth/me`, then restores the matching local workspace and saved onboarding route. Initialization, browser focus, visibility changes, and a 60-second check revalidate the server session. Invalid sessions clear authentication while keeping workspace drafts. Unavailable verification blocks protected screens and offers retry rather than granting access from a cached profile.
4. Logout calls the backend before clearing in-memory identity and returning to login. A failed logout shows an error and retains the current state. The backend deletes the cookie with matching path/security/SameSite attributes. A cleared browser session can no longer call `/auth/me`.

Checked “Remember this browser for 30 minutes” adds a 1,800-second cookie Max-Age. Unchecked uses a browser-session cookie; the JWT still expires after 30 minutes. Browser session-restore features can retain session cookies, so expiration is always enforced by the server.

## Local workspace compatibility

Onboarding, brand analysis, competitors, generation, posts, calendar, analytics, and social account placeholders are still mocks. Workspace content is **not stored in PostgreSQL**. Local workspace caches use `socialai-demo-v1:user:<verified-user-UUID>` and never contain JWTs or passwords. Persisted `authenticated` is false and the profile is omitted; it is always reconstructed from `/auth/me`.

The previous `socialai-demo-v1` cache is preserved. If its profile email matches a verified server user, its drafts and progress are adopted into that user's cache. Another user's cache is never adopted. A legacy profile does not prove authentication. The old public demo button now takes visitors through login; it cannot bypass the guards. Settings resets only the active user's mock workspace, not their PostgreSQL account. Profile editing remains a clearly labeled local display preview, not an account update API.

## Configuration

Existing `.env` files are left untouched. The frontend defaults to:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

Set that public URL through the existing environment mechanism if necessary; it must not contain database credentials or a JWT secret. Restart/rebuild Next.js after changing it.

Backend authentication settings (existing PostgreSQL settings remain unchanged):

| Variable           | Development behavior                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`       | Required existing environment secret, at least 32 characters; use a cryptographically random value |
| `ENVIRONMENT`      | `development`; set `production` when deploying                                                     |
| `COOKIE_SECURE`    | Defaults to false locally; defaults to true in production                                          |
| `FRONTEND_ORIGINS` | Comma-separated explicit origins; default `http://localhost:3000`                                  |
| `API_ORIGINS`      | Trusted same-origin API/Swagger origins; default `http://localhost:8000,http://127.0.0.1:8000`     |

Production refuses insecure cookies or HTTP trusted origins. Configure **both** origin variables with HTTPS production values. Cookies are host-only, SameSite=Lax, and the JWT algorithm is explicitly HS256. Prefer a same-site deployment or reverse proxy. A genuinely cross-site deployment requires a separately reviewed cookie/CSRF design; do not work around it by turning off checks.

Auth POST requests require an exact trusted `Origin`, including register, login, and logout. CORS allows only configured frontend origins and credentials. Same-origin Swagger POSTs work when opened on a configured API origin. Command-line/test callers must supply a trusted Origin; missing origins are rejected rather than exempting Swagger or relying on CORS alone. Future cookie-authenticated mutation endpoints must reuse the origin check and independently enforce the authenticated user.

Registration duplicate races return 409 after rollback; database failures return 503 with no query or connection detail. Auth validation responses omit rejected input so passwords are not echoed. Successful auth responses and validation failures use `Cache-Control: no-store`.

## Run the existing services

From `D:\sonal-akoode\AISocialMedia`, with the existing environment files:

```powershell
docker compose up -d postgres pgadmin
```

In a backend terminal:

```powershell
cd D:\sonal-akoode\AISocialMedia\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a frontend terminal:

```powershell
cd D:\sonal-akoode\AISocialMedia\frontend
npm run dev
```

Open `http://localhost:3000`. API documentation: `http://localhost:8000/docs`. pgAdmin remains `http://localhost:5050`. Existing running services can be reused; do not start a second listener on the same port.

## Verification

Backend tests use the existing `.venv` and the real PostgreSQL schema with a connection-level outer transaction plus per-session savepoints. Every test rolls back its own writes; no existing records are deleted and no test table is dropped or recreated.

```powershell
cd D:\sonal-akoode\AISocialMedia\backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m alembic current
```

```powershell
cd D:\sonal-akoode\AISocialMedia\frontend
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Playwright reuses the running frontend, or starts `npm start` after a production build. The backend and PostgreSQL must be running. Install its Chromium browser with `npx playwright install chromium` if necessary. Browser tests register uniquely named `e2e-…@example.com` users through the real API. These committed test accounts intentionally remain in the development database; the suite never deletes real development users. Auth POST test requests carry the permitted Origin. The original journey tests now log in with a real server cookie; responsive/mock-content checks seed only user-scoped workspace data after a real login. Additional tests cover forged local auth, validation/API errors, session restoration, expiry, failed/successful logout, and API unavailability.

## Verified results

- PostgreSQL schema inspected directly; Alembic remains at `148ca6c35a66` (head), with no migrations needed.
- Backend: **29 tests passed**, using PostgreSQL transactions rolled back after each case. A test-client dependency deprecation warning is informational; it does not affect results.
- Frontend: **24 unit tests passed**, including all 10 original workspace/mock-service tests. TypeScript, lint, and the production build passed.
- Browser: all **8 checks passed** across the final suite and the targeted responsive rerun. Coverage includes real registration/login, stored Argon2 hashes and HttpOnly cookies, refresh, full onboarding/content/calendar navigation, return after logout, localStorage forgery rejection, errors, expired sessions, failed logout, and all four responsive widths. The responsive sweep was increased to 120 seconds for its 28 authenticated loads against the running development server.
- Real browser-created accounts were checked directly in PostgreSQL: password hashes are Argon2 and email verification remains false. Browser-created `e2e-…` test accounts were retained; no development records or volumes were removed.

## Remaining production requirements

- **Production blocker:** implement shared/distributed registration and login rate limiting, abuse monitoring, and an account lockout/backoff policy. No suitable limiter existed; this integration does not introduce unrelated infrastructure.
- Stateless JWT logout clears this browser's cookie; it **does not revoke a stolen token**. Add server-side session IDs/token revocation, key rotation, and a reviewed refresh/session lifecycle before production.
- Enable HTTPS, Secure cookies, exact production origins, secret management, secure proxy configuration, and appropriate security headers. Generate the JWT secret from high-entropy random bytes; minimum length alone does not establish entropy.
- Add email verification, actual password reset delivery, account/profile update APIs, audit logging with credential redaction, authorization for future APIs, and reviewed privacy/terms. `is_verified` remains false.
- Move sensitive workspace data to an authorized backend. Browser caches and client guards are UX controls, not authorization or secure storage. Every sensitive backend endpoint must enforce its own authentication and resource permissions.
- Frontend signed-out detection is checked on startup, focus/visibility, and periodically; it is not a substitute for server enforcement on each protected request.
- Existing repository history already tracks virtual-environment/bytecode files. New ignore rules prevent new generated files being added, but this work does not rewrite the index/history or discard previously tracked files. Do not commit generated `.pyc`/`.venv` changes.

## File inventory

| Created/modified file                            | Purpose                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `.gitignore`                                     | Ignore new Python environments, bytecode, and pytest cache                                      |
| `backend/app/api/auth.py`                        | Complete existing routes, required claims, safe errors, cookie/origin handling                  |
| `backend/app/core/auth_config.py`                | Reuse secret and centralize configurable trusted origins/cookie settings                        |
| `backend/app/core/security.py`                   | Reuse Argon2/JWT, centralize expiration, safely reject invalid password hashes                  |
| `backend/app/db/database.py`                     | Bound pool/connect waits for unavailable-database responses                                     |
| `backend/app/schemas/auth.py`                    | Normalize input, registration strength checks, remember preference                              |
| `backend/app/main.py`                            | Preserve existing initialization fix, share CORS settings, redact auth validation input         |
| `backend/requirements-dev.txt`                   | Isolated pytest/httpx test dependencies                                                         |
| `backend/tests/conftest.py`                      | PostgreSQL rollback fixtures and auth clients                                                   |
| `backend/tests/test_auth.py`                     | Backend authentication/security/error tests                                                     |
| `frontend/src/lib/auth-api.ts`                   | Credentialed API calls, safe response types, timeouts, errors                                   |
| `frontend/src/lib/storage.ts`                    | User-scoped cache keys and legacy onboarding adapter                                            |
| `frontend/src/lib/validations.ts`                | Mode-specific auth form validation matching registration rules                                  |
| `frontend/src/store/provider.tsx`                | Extend existing Context with verified cookie sessions and shared logout                         |
| `frontend/src/types/index.ts`                    | Add optional server identity metadata without breaking mock fixtures                            |
| `frontend/src/components/auth.tsx`               | Wire existing forms to real signup/login; retain layout                                         |
| `frontend/src/components/auth-session.tsx`       | Session-check/loading/failure retry UI using existing components                                |
| `frontend/src/components/onboarding.tsx`         | Require verified session and preserve saved onboarding navigation                               |
| `frontend/src/components/dashboard/shell.tsx`    | Verified route guard and shared real logout actions                                             |
| `frontend/src/components/dashboard/sections.tsx` | Real settings logout; clarify local reset/profile behavior                                      |
| `frontend/src/components/landing.tsx`            | Prevent the old demo CTA from fabricating authentication                                        |
| `frontend/src/app/[auth]/page.tsx`               | Correct privacy/authentication copy for real backend auth                                       |
| `frontend/tests/unit/auth-api.test.ts`           | API client, validation, and workspace compatibility tests                                       |
| `frontend/tests/e2e/auth-helpers.ts`             | Real API/cookie setup and isolated mock-workspace fixtures                                      |
| `frontend/tests/e2e/auth.spec.ts`                | Browser authentication, failure, and guard verification                                         |
| `frontend/tests/e2e/journey.spec.ts`             | Preserve existing content journey with real signup/login                                        |
| `README.md`                                      | Updated service startup, auth behavior, and remaining mock features                             |
| `docs/authentication.md`                         | Audit, architecture, configuration, security limitations, test/run instructions, file inventory |
