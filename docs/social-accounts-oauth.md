# Social account connections — Phase 8A (LinkedIn first)

Implemented 19 November 2026 on the existing FastAPI / SQLAlchemy / PostgreSQL / Next.js application.

**Scope:** connect, verify, reconnect and disconnect company social accounts. **Nothing is published.** No post, schedule, approval state or worker transition is created or changed by this phase, and no publishing confirmation exists anywhere.

**Live status:** the code path for real LinkedIn OAuth is implemented and covered by automated tests against a mocked LinkedIn. **It has not been verified against the real LinkedIn**, because no LinkedIn developer credentials are configured in this environment (see §13). The running application honestly shows *Setup required* for LinkedIn until an administrator configures it.

---

## 1. Architecture

```text
Browser (SocialAI, cookie session)                FastAPI                                LinkedIn
──────────────────────────────────                ───────                                ────────
Connect LinkedIn ──POST /companies/{id}/social-accounts/linkedin/connect (Origin checked)──▶
                                                 owner/admin check, lock company
                                                 state, nonce, binding = 3 × 256-bit random
                                                 store SHA-256 hashes (10 min, single use)
◀── { authorization_url } + Set-Cookie socialai_oauth_<id> (HttpOnly, Lax, callback path)
window.location → https://www.linkedin.com/oauth/v2/authorization?response_type=code&…  ──▶ consent
                                                                                        ◀── 302 redirect_uri?code&state
GET /api/v1/social-accounts/oauth/linkedin/callback?code&state ──▶
                                                 1 consume state atomically (replay ⇒ rejected)
                                                 2 binding cookie hash must match (same browser)
                                                 3 SocialAI session must be the initiating user
                                                 4 cancellation / denial ⇒ stop, no exchange
                                                 5 POST /oauth/v2/accessToken (client_secret) ──▶
                                                 6 verify ID token: RS256 + JWKS, iss, aud, exp, nonce
                                                 7 GET /v2/userinfo; sub must equal ID-token sub   ──▶
                                                 8 re-check owner/admin, lock company → account
                                                 9 upsert account, AES-256-GCM encrypt credential
◀── 303 {frontend}/dashboard/accounts?social=<fixed code>&company=…&account=…
     (Referrer-Policy: no-referrer, Cache-Control: no-store, binding cookie cleared)
```

| Layer | File |
| --- | --- |
| Settings (server-only) | `backend/app/core/social_config.py` |
| Credential encryption | `backend/app/core/token_crypto.py` |
| Models | `backend/app/models/social_accounts.py` |
| LinkedIn client | `backend/app/services/linkedin_oauth.py` |
| Lifecycle service | `backend/app/services/social_accounts.py` |
| API router + callback | `backend/app/api/social_accounts.py` |
| Response schemas | `backend/app/schemas/social_accounts.py` |
| Key rotation script | `backend/scripts/rotate_social_token_key.py` |
| Frontend API client | `frontend/src/lib/social-accounts-api.ts` |
| Social Accounts page | `frontend/src/components/dashboard/social-accounts.tsx` |
| Cross-CRM availability note | `frontend/src/components/social-availability.tsx` |

The platform registry (`PLATFORMS` in the service, `{platform}` path segment in the router) is where Instagram, Facebook and X providers plug in later. They currently report `coming_later` and their connect routes return 409.

The SocialAI login session and the LinkedIn connection are separate: LinkedIn identity is never used to sign in to SocialAI, and the SocialAI JWT/cookie are unchanged.

## 2. Database schema and migration

Migration **`201c3d52e47b`** (`add social account connections`) follows `0eaa6d711c8f`. It is additive only: three new tables, no change to any existing table, no backfill. In particular `post_schedules.social_account_id` and its `ck_schedule_no_account` guard are untouched, so no schedule can reference an account. Applied to the development database. `alembic check` reports no pending operations. **Do not downgrade a deployment that holds real connections**: downgrade drops the tables and the encrypted credentials.

### `social_accounts`
| Column | Notes |
| --- | --- |
| `id`, `revision`, `created_at`, `updated_at` | Standard `Editable` columns (optimistic version) |
| `company_id` | FK `companies` RESTRICT — owning tenant |
| `platform` | `LinkedIn`/`Instagram`/`Facebook`/`X` (check) |
| `provider_account_id` | LinkedIn OIDC `sub`. Never returned by the API |
| `account_type` | `person`/`organization` (Phase 8A: `person`) |
| `display_name`, `email`, `email_verified`, `avatar_url` | From verified userinfo; avatar must be HTTPS |
| `capabilities`, `granted_scopes` | JSONB arrays derived from scopes LinkedIn actually granted |
| `status` | `connected`/`limited`/`reconnect_required`/`disconnected`/`error` (check) |
| `last_error_code` | Fixed codes only (e.g. `token_revoked`) |
| `connected_by`, `connected_at`, `last_verified_at` | |
| `token_expires_at`, `refresh_token_expires_at` | Non-secret expiry metadata |
| `disconnected_at`, `disconnected_by` | Check: `status = 'disconnected'` ⇔ `disconnected_at IS NOT NULL` |

Constraints: unique `(company_id, platform, provider_account_id)` (one row per member per company; reconnects upsert); unique `(id, company_id)` as the target of tenant-safe composite FKs; index `(company_id, status)`.

### `social_account_credentials` (secret-bearing)
`social_account_id` + `company_id` → composite FK to `social_accounts(id, company_id)` ON DELETE CASCADE, so a credential can never belong to a different company than its account. Unique per account. `key_version`, `access_token_ciphertext` (bytea), nullable `refresh_token_ciphertext`, `granted_scopes`, `access_token_expires_at`, `refresh_token_expires_at` (must be NULL without a refresh token). No schema serializes this table.

### `oauth_authorization_states`
`state_hash` (unique), `nonce_hash`, `binding_hash` (all SHA-256 hex, length checked), `user_id`, `company_id`, `platform`, `purpose` (`connect`/`reconnect`), `target_account_id` (composite FK with `company_id` — reconnect targets cannot cross tenants; required iff `reconnect`), `redirect_uri`, `return_origin`, `requested_scopes`, `created_at`, `expires_at` (> created_at), `consumed_at`. Raw state/nonce/binding values are never stored. Rows older than one day past expiry are pruned (bounded, 500 per start).

**Ownership decision:** companies already own all content, and workspace membership is the authorization boundary. A connection therefore belongs to exactly one company. The same LinkedIn member may be authorized separately for two companies; each authorization produces its own row and its own credential (verified by test). Credentials are never shared or copied between companies.

## 3. API contracts

Under `/api/v1/companies/{company_id}/social-accounts`. Existing HttpOnly cookie auth, existing `request_policy` (trusted Origin on every non-GET, `Cache-Control: no-store`). Members read; owners/admins write. Other tenants' companies/accounts → 404; anonymous → 401; read-only member writes → 403.

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `` | `{items: SocialAccount[], connected_count, publishing_enabled: false}`; `?include_disconnected=true` adds disconnected rows. Stored state only. |
| GET | `/platforms` | Capability catalog: LinkedIn `available` or `configuration_required` with the *names* of missing settings; others `coming_later`. |
| POST | `/{platform}/connect` | Owner/admin. `linkedin` → `{authorization_url, expires_at}` + binding cookie. 503 if not configured, 409 for coming-later platforms, 404 unknown, 403 if the Origin is not a frontend origin. |
| GET | `/{account_id}` | Account detail (no secrets). |
| GET | `/{account_id}/status` | Status derived from stored state. **No provider call.** |
| POST | `/{account_id}/reconnect` | Owner/admin. New authorization bound to this account; the callback rejects a different LinkedIn member (`wrong_account`). |
| POST | `/{account_id}/verify` | Owner/admin, explicit. One LinkedIn token-introspection call (plus a refresh call only if the token expired and LinkedIn issued a refresh token). Provider outage/401 → 502 and stored status unchanged. |
| POST | `/{account_id}/disconnect` | Owner/admin. Deletes the credential, marks `disconnected`, cancels unused reconnect states. Idempotent. Returns `{account, provider_access_revoked: false, guidance}`. |

Provider-level route: `GET /api/v1/social-accounts/oauth/linkedin/callback` → always a 303 to `{frontend}/dashboard/accounts?social=<code>&platform=linkedin[&company][&account]`.

Callback codes: `connected`, `reconnected`, `cancelled`, `denied`, `invalid_state`, `state_expired`, `state_reused`, `session_expired`, `session_mismatch`, `not_authorized`, `wrong_account`, `configuration_required`, `provider_error`, `identity_unverified`, `storage_error`.

`SocialAccount` fields: `id, company_id, platform, account_type, display_name, email, email_verified, avatar_url, capabilities, granted_scopes, status, publishing_permission, refresh_available, last_error_code, connected_at, last_verified_at, token_expires_at, disconnected_at, revision, created_at, updated_at`.

CRM: `GET /companies/{id}/dashboard/summary` gains additive `social_account_stats {total, connected, limited, reconnect_required, error, connected_platforms, publishing_permission}`. `publishing_available` stays `false`.

## 4. OAuth flow security

| Requirement | Implementation |
| --- | --- |
| Random one-time state | `secrets.token_urlsafe(32)`; only SHA-256 stored; consumed by atomic `UPDATE … WHERE consumed_at IS NULL RETURNING` and committed **before** any provider call. Replay → `state_reused`, unknown → `invalid_state`, expired (10 min, configurable 1–30) → `state_expired`. |
| CSRF / login-CSRF | Per-transaction binding cookie (`socialai_oauth_<hash prefix>`, HttpOnly, SameSite=Lax, Path `/api/v1/social-accounts/oauth`, Secure in production) whose hash is stored with the state; the callback also requires the initiating user's SocialAI session. An attacker's code/state cannot be completed in a victim's browser. |
| Exact redirect URI | The configured URI is sent, stored with the state and must equal the current configuration at callback; the same value is sent in the code exchange. Validation requires an absolute URL ending `/social-accounts/oauth/linkedin/callback`, no query/fragment, HTTPS outside localhost and always in production. |
| No open redirect | Return target = fixed path on an origin from `FRONTEND_ORIGINS` recorded at start (from the validated `Origin` header). Unknown/forged states use the first configured origin. The frontend only navigates to URLs starting `https://www.linkedin.com/oauth/v2/authorization?`. |
| Secure code exchange | Server-side `POST https://www.linkedin.com/oauth/v2/accessToken` (form) with `client_secret`; no redirects followed; 10 s timeout. |
| OIDC validation | ID token required. RS256 only, key by `kid` from `https://www.linkedin.com/oauth/openid/jwks` (cached 1 h, one forced refetch for rotation), `aud = client_id`, `iss ∈ {https://www.linkedin.com/oauth, https://www.linkedin.com}` (LinkedIn's discovery document and reference table publish these two values), `exp`/`iat` required (60 s leeway), `sub` required. Userinfo `sub` must equal the ID-token `sub`. |
| Nonce | Sent and stored hashed; if LinkedIn echoes `nonce` it must match. LinkedIn does not document nonce support, so protection does not depend on it. |
| PKCE | Not sent: LinkedIn documents no PKCE parameters for confidential web clients. The confidential client secret, state and binding cookie provide the protection. Revisit if LinkedIn documents PKCE for web apps. |
| Token exposure | Tokens never appear in URLs, responses, logs, browser storage or the UI. Callback responses send `Referrer-Policy: no-referrer`. LinkedIn's `error_description` is ignored. Oversized parameters are rejected by the service rather than a 422 (which would echo input). `TokenSet.__repr__` hides secrets. |
| Cancellation / denial | `user_cancelled_login`/`user_cancelled_authorize` → `cancelled`; any other `error` → `denied`. No token exchange. |
| Stale session / wrong user | No SocialAI session → `session_expired`; another user or missing binding cookie → `session_mismatch`. |
| Cross-company linking | The callback re-authorizes the user as owner/admin of the state's company at completion time; a role change during consent → `not_authorized`. Composite FKs make cross-company credentials and reconnect targets unstorable. |
| Locks | No database lock is held during provider calls; company → account lock order matches existing services. |

## 5. LinkedIn developer setup

1. Sign in at <https://www.linkedin.com/developers/> → **Create app** (requires a LinkedIn Company Page to associate).
2. **Products** tab → request **Sign In with LinkedIn using OpenID Connect**. This grants `openid`, `profile`, `email` only. It does **not** grant publishing.
3. Optional, for Phase 8B: request **Share on LinkedIn** (grants `w_member_social`, posting as the member). Organization-page posting (`w_organization_social`) requires Community Management API access and company-page admin roles. Neither is assumed.
4. **Auth** tab → copy *Client ID* and *Primary Client Secret*; add the redirect URL exactly:
   - Local: `http://localhost:8000/api/v1/social-accounts/oauth/linkedin/callback`
   - Production: `https://<api-host>/api/v1/social-accounts/oauth/linkedin/callback` (LinkedIn requires HTTPS; our validation enforces it in production).
5. Configure the backend environment (existing `backend/.env` mechanism, never committed). Values shown are placeholders:

```dotenv
LINKEDIN_CLIENT_ID=<client id>
LINKEDIN_CLIENT_SECRET=<client secret>
LINKEDIN_REDIRECT_URI=http://localhost:8000/api/v1/social-accounts/oauth/linkedin/callback
LINKEDIN_SCOPES=openid profile email
SOCIAL_TOKEN_ENCRYPTION_KEY=<32 random bytes, base64url>
SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION=1
# Optional: SOCIAL_TOKEN_PREVIOUS_KEYS=<version>:<key>,…   SOCIAL_OAUTH_STATE_MINUTES=10
```

Generate the key with `python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"`. It must differ from `JWT_SECRET` (enforced). Restart the API after changing settings. Add `w_member_social` to `LINKEDIN_SCOPES` **only after** LinkedIn grants *Share on LinkedIn*: LinkedIn rejects the whole authorization for an unapproved scope, and a requested scope is never treated as granted.

The *Integrations* page lists any missing/invalid setting by name (never by value) and disables **Connect LinkedIn** until resolved.

## 6. Scopes and capabilities

| Granted scope | Capability shown | Effect |
| --- | --- | --- |
| `openid` | Verified LinkedIn identity | Required |
| `profile` | Name and profile photo | Required |
| `email` | Email address | Optional |
| `w_member_social` | Publishing permission (w_member_social) | Status `connected`; still **not used** in 8A |

Without `w_member_social` the status is **Limited permissions** ("Your LinkedIn account is connected, but publishing permission is not currently available."). Capabilities come only from the `scope` LinkedIn returns (verified by test: requesting `w_member_social` without LinkedIn granting it stays *Limited*).

## 7. Encrypted token storage and key rotation

- AES-256-GCM (`cryptography` AEAD), fresh 96-bit nonce per value; stored blob `nonce || ciphertext+tag`.
- Associated data `socialai:social_account_credential:<account id>:<field>:v<version>` binds each ciphertext to its account, field and key version: copying a blob to another row or tenant fails authentication (tested).
- Key from `SOCIAL_TOKEN_ENCRYPTION_KEY` (environment, not database/source), must decode to exactly 32 bytes and must not equal `JWT_SECRET`.
- Token/scope/expiry metadata is stored in plain columns, separate from ciphertext.
- **Rotation:** set the new key with a higher `SOCIAL_TOKEN_ENCRYPTION_KEY_VERSION`, list the old key in `SOCIAL_TOKEN_PREVIOUS_KEYS` (`1:<old key>`), restart, run `python scripts/rotate_social_token_key.py` (dry run) then `--apply`. It re-encrypts row by row under a row lock and prints counts/IDs only. When `remaining_on_old_versions` is 0, remove the old key. Losing a key makes its credentials unrecoverable: affected accounts must reconnect.

## 8. Token expiry, refresh and reconnection

- LinkedIn access tokens last 60 days (`expires_in`), stored as `token_expires_at`.
- Refresh tokens are issued only to approved Marketing Developer Platform partners. The client stores one **only if LinkedIn returns it** and never invents one. With a refresh token, **Verify** refreshes an expired token (LinkedIn keeps the refresh token's original 365-day TTL). Without one, an expired token makes the status **Reconnect required**.
- Status is derived from stored state on every read (no provider call): disconnected/error/reconnect_required stay as stored; a missing credential or an expired token without a usable refresh token reads as `reconnect_required`; otherwise the stored `connected`/`limited`.
- **Verify** (explicit button) calls LinkedIn token introspection: `active` → refresh scopes/expiry and `last_verified_at`; `revoked` → `reconnect_required`/`token_revoked`; `expired` → refresh or `token_expired`; a credential that cannot be decrypted → `error`/`credential_unreadable`. Outages and a rejected client secret return 502 and change nothing. A concurrent reconnect/disconnect during verification returns 409 rather than overwriting newer state.
- **Reconnect** replaces the credential in place on the same account row; signing in as a different member is rejected (`wrong_account`) and leaves the account untouched. Connecting a disconnected member again revives the same row.

## 9. Disconnect

Disconnect deletes the encrypted credential row, sets `disconnected` with `disconnected_at/by`, clears expiry metadata and deletes unused reconnect states for that account. Posts, schedules and history are untouched. **LinkedIn documents no token-revocation endpoint**, so SocialAI cannot revoke the grant at LinkedIn. The response (`provider_access_revoked: false`) and the UI tell the user to remove the app in LinkedIn: *Settings → Data privacy → Permitted services*. The access token otherwise expires on its own (≤ 60 days).

## 10. Tenant isolation

- Every route resolves the company through `company_access` (membership join) and every account through `(account_id, company_id)`. Foreign IDs → 404.
- Composite FKs `(social_account_id, company_id)` and `(target_account_id, company_id)` → `social_accounts(id, company_id)`.
- AEAD associated data includes the account ID.
- Frontend reads are keyed by company; switching company remounts the page, sidebar count and availability notes (browser-tested).

## 11. UI and CRM integration

- **Social Accounts** page: heading/subtitle as specified; *Connected accounts* list (platform icon, avatar with initials fallback and `referrerPolicy="no-referrer"`, name, account type, status chip, publishing capability, last verified, Details/Verify/Reconnect/Disconnect); *Available platforms* with the LinkedIn card (Connect / LinkedIn connected / Limited permissions / Reconnect required / Setup required) and non-interactive Instagram, Facebook, X *Coming later* cards; accessible Radix dialogs for details and disconnect confirmation; callback outcome banners (success/info/alert) that clear the URL on dismiss; loading, error and per-action busy states; responsive at 375 px without horizontal overflow.
- **Sidebar:** connected count badge on *Social Accounts* (only when > 0).
- **CRM Overview:** the former "Publishing integration not connected" note now shows the real connected count/platforms and reconnect warnings, still stating publishing is not enabled.
- **Content Studio, Post Library, Content Calendar, schedule form:** a read-only availability note per company (platform-specific in the schedule form). It never binds an account to a post or schedule.
- No approval, scheduling, worker or `awaiting_publisher` behaviour was changed. Existing schedules remain unbound (`social_account_id IS NULL` is still enforced by the database).

## 12. Testing results

| Check | Result |
| --- | --- |
| Backend baseline before changes | 291 passed; `alembic check` clean at `0eaa6d711c8f` |
| Backend after (full suite) | **327 passed** (291 existing + 36 new in `tests/test_social_accounts.py`) |
| Frontend unit (`npm test`) | **77 passed** (13 files, incl. new `social-accounts.test.ts`) |
| TypeScript (`tsc --noEmit`), ESLint | Passed |
| Production build (`next build`) | Passed |
| Alembic | `upgrade head` applied `201c3d52e47b`; `alembic check`: no new upgrade operations |
| Social Accounts browser spec | **5 passed** |
| Full browser suite | see §12a |
| Data preservation | see §12b |
| Environment files | `backend/.env` and root `.env` SHA-256 unchanged |

Backend tests use a fake LinkedIn behind `httpx.MockTransport` that signs real RS256 ID tokens with a test RSA key and serves the matching JWKS. They cover: authorization URL/params and hashed state storage; Origin requirement; full callback success with encrypted credential and no token in any response; publishing scope recorded only when granted; replayed, missing, forged, oversized and expired state; cancellation and denial without token exchange; missing binding cookie, other user, expired session; membership revoked during consent; token-endpoint 400/401/500 and network failure; ID-token audience, issuer, expiry, signature, nonce, missing token, userinfo-sub mismatch, HS256 algorithm confusion, and the alternate documented issuer; reconnect replacing the credential and `wrong_account`; duplicate connect upsert; one member in two companies with separate credentials; cross-tenant 404s, member 403s, admin access, anonymous 401, evil Origin 403; AEAD binding and the composite-FK guard; disconnect, idempotent replay, revive; expiry without refresh; refresh token stored only when supplied and used on expiry; verify active/revoked/outage/401; encryption round trip, tamper detection, versions, previous keys, JWT-secret reuse; rotation script; secret-free `repr`; CRM counts; **no posts, schedules or schedule events created or changed and no LinkedIn publishing endpoint called**.

Browser tests: real backend (honest configuration-blocked state with the exact missing settings, inactive platform cards without buttons, empty list, CRM overview text, desktop + 375 px screenshots without overflow; forged callback → 303 `invalid_state`, no code echo, `no-referrer`). UI-fixture tests replace only the social-account API responses with a clearly labelled fixture record (`Asha Rao (UI fixture)`) to exercise the limited/connected card, details dialog, sidebar count, disconnect confirmation, connect navigation (to a LinkedIn test double; the real LinkedIn is never contacted), outcome banners, company switching isolation and Calendar/Post Library availability notes. **UI-fixture screenshots do not represent a real LinkedIn connection.**

Screenshots: `frontend/artifacts/social-accounts-desktop.png`, `social-accounts-mobile.png` (real backend, setup-required state), `social-accounts-connected-desktop.png`, `social-accounts-connected-mobile.png` (UI fixture).

### 12a. Full browser suite

**42 passed in one uninterrupted run (5.0 min)**: all 37 pre-existing tests, including the live shared-worker *Awaiting Publisher* journey, plus the 5 new social-account tests. The run used the existing SocialAI development frontend on `http://localhost:3001` (`SOCIALAI_E2E_BASE_URL`; port 3000 on this machine belongs to an unrelated project), the running FastAPI API and the shared worker. No test was disabled.

### 12b. Data preservation

- Baseline before any change: 6,314 rows in 18 tables at `0eaa6d711c8f`.
- Per-row MD5 snapshot taken immediately after the migration (6,326 rows; the 12 extra rows were committed by the existing worker-concurrency tests in the baseline run): after all backend and browser runs, **0 rows missing or changed**.
- New tables after all runs: `social_accounts` 0, `social_account_credentials` 0, `oauth_authorization_states` 0 (backend tests roll back; browser fixtures never reach the database). `post_schedules` rows with a `social_account_id`: 0.
- Additional rows are the existing suites' labelled `e2e-…@example.com` test users, workspaces, companies and content, as in earlier phases. Nothing was deleted, reset or backfilled.

## 13. Live OAuth evidence

**Not performed.** No `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` or `SOCIAL_TOKEN_ENCRYPTION_KEY` exists in `backend/.env`, the root `.env` or the process environment (checked by variable name only). No real LinkedIn callback has been received and no live connection is claimed. To perform the one controlled live test: complete §5, restart the API, sign in, select a company, click **Connect LinkedIn**, approve on LinkedIn, and confirm the page shows the same name/email as the LinkedIn member who approved. Then confirm in PostgreSQL that `social_account_credentials.access_token_ciphertext` does not contain the token, and click **Verify**.

## 14. Remaining limitations and blockers

- **Blocker for live use:** LinkedIn app credentials, the *Sign In with LinkedIn using OpenID Connect* product and the encryption key must be configured (§5).
- Publishing requires LinkedIn to grant *Share on LinkedIn* (`w_member_social`); organization pages need Community Management API approval. Neither is available or assumed.
- No provider-side revocation (LinkedIn documents none); users must remove the app in LinkedIn settings.
- Refresh tokens only for approved MDP partners; others must reconnect before the 60-day expiry. There is no background expiry reminder or scheduled re-verification (status reads never call LinkedIn by design).
- Avatar URLs are LinkedIn CDN links and may expire; the UI falls back to initials. Reconnect refreshes them.
- Two simultaneous connect attempts in the same tab context are independent (per-transaction cookies), but each must finish within 10 minutes.
- Production must run the API behind HTTPS with `COOKIE_SECURE=true`, exact HTTPS `FRONTEND_ORIGINS`/`API_ORIGINS`, and a secret manager for the client secret and encryption keys. Existing auth limitations (no rate limiting, stateless JWT revocation) from `docs/authentication.md` still apply.

## 15. Modified-file inventory

New:

```text
backend/alembic/versions/201c3d52e47b_add_social_account_connections.py
backend/app/api/social_accounts.py
backend/app/core/social_config.py
backend/app/core/token_crypto.py
backend/app/models/social_accounts.py
backend/app/schemas/social_accounts.py
backend/app/services/linkedin_oauth.py
backend/app/services/social_accounts.py
backend/scripts/rotate_social_token_key.py
backend/tests/test_social_accounts.py
frontend/src/app/social-accounts.css
frontend/src/components/dashboard/social-accounts.tsx
frontend/src/components/social-availability.tsx
frontend/src/lib/social-accounts-api.ts
frontend/src/store/use-social-accounts.ts
frontend/tests/e2e/social-accounts.spec.ts
frontend/tests/unit/social-accounts.test.ts
frontend/artifacts/social-accounts-{desktop,mobile,connected-desktop,connected-mobile}.png
docs/social-accounts-oauth.md
```

Updated (all previously clean; none of the pre-existing uncommitted files were edited):

```text
backend/alembic/env.py                               register social account models
backend/app/main.py                                  register social routers
backend/app/schemas/crm.py                           additive social_account_stats
backend/app/services/crm.py                          populate social_account_stats
backend/requirements.txt                             pin cryptography==50.0.2 (already installed; now imported directly)
frontend/src/app/layout.tsx                          import social-accounts.css
frontend/src/app/dashboard/[section]/page.tsx        callback outcome params; Studio availability note
frontend/src/components/dashboard/sections.tsx       placeholder Accounts replaced by real page re-export
frontend/src/components/dashboard/shell.tsx          sidebar connected count
frontend/src/components/dashboard/crm-overview.tsx   real connection state panel
frontend/src/lib/crm-api.ts                          social_account_stats schema
frontend/src/components/content/post-library.tsx     availability note
frontend/src/components/content/schedule-form.tsx    platform availability note
frontend/src/components/dashboard/real-calendar.tsx  availability note
```

No existing migration, authentication module, `.env`, scheduling policy/worker or historical record was modified.

## 16. Phase 8B prerequisites

1. Configure and live-verify LinkedIn OAuth (§13); obtain *Share on LinkedIn* and re-connect accounts so `w_member_social` is actually granted.
2. Reviewed migration replacing `ck_schedule_no_account` with a tenant-safe composite FK `post_schedules(social_account_id, company_id) → social_accounts(id, company_id)`, plus an explicit account-selection step. Never auto-bind existing schedules.
3. Publication attempts table with durable external-call idempotency, `x-restli-id` capture and reconciliation; `Linkedin-Version` header management (LinkedIn sunsets versions about yearly).
4. Worker transition `awaiting_publisher → publishing → published/failed` only on confirmed provider responses; rate limits, retries with backoff and permanent-error mapping; token decryption only inside the worker at call time.
5. Media upload (LinkedIn Images API) and per-platform content validation.
6. Pre-expiry reconnect reminders and optional scheduled introspection.
7. Instagram/Facebook (Meta Graph API, page tokens) and X providers on the same registry.
