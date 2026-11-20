import { test, expect, type Page, type Route } from "@playwright/test";
import { signInWorkspace, apiURL } from "./auth-helpers";

/**
 * Phase 8A Social Accounts.
 * - "real backend" tests use the running FastAPI/PostgreSQL API with no mocks.
 * - "UI fixture" tests replace only the social-account API responses with fixed records
 *   so connected states can be exercised without a live LinkedIn app. They never claim a
 *   real LinkedIn connection; the real OAuth callback is covered by backend tests.
 */
const headers = { Origin: "http://localhost:3000" };

const account = (companyId: string, overrides: Record<string, unknown> = {}) => ({
  id: "6f1c2c2e-2a43-4a8e-9c1d-8a4d2b7e9f10",
  company_id: companyId,
  platform: "LinkedIn",
  account_type: "person",
  display_name: "Asha Rao (UI fixture)",
  email: "asha.fixture@example.com",
  email_verified: true,
  avatar_url: null,
  capabilities: ["verified_identity", "profile", "email"],
  granted_scopes: ["email", "openid", "profile"],
  status: "limited",
  publishing_permission: false,
  refresh_available: false,
  last_error_code: null,
  connected_at: "2026-11-19T06:30:00Z",
  last_verified_at: "2026-11-19T06:30:00Z",
  token_expires_at: "2027-01-18T06:30:00Z",
  disconnected_at: null,
  revision: 1,
  created_at: "2026-11-19T06:30:00Z",
  updated_at: "2026-11-19T06:30:00Z",
  ...overrides,
});
const platformsFixture = (integration = "available") => ({
  publishing_enabled: false,
  items: [
    {
      platform: "LinkedIn",
      slug: "linkedin",
      integration,
      description: "Connect a LinkedIn member profile.",
      requested_scopes: ["openid", "profile", "email"],
      publishing_scope_requested: false,
      supports_refresh_tokens: "provider_dependent",
      supports_provider_revocation: false,
      configuration_issues: [],
    },
    ...["Instagram", "Facebook", "X"].map((platform) => ({
      platform,
      slug: platform.toLowerCase(),
      integration: "coming_later",
      description: `${platform} connections are coming in a later phase.`,
      requested_scopes: [],
      publishing_scope_requested: false,
      supports_refresh_tokens: "unknown",
      supports_provider_revocation: false,
      configuration_issues: [],
    })),
  ],
});

async function json(route: Route, body: unknown, page: Page) {
  const origin = new URL(page.url() || "http://localhost:3000").origin;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  });
}

/** Mock only /companies/{id}/social-accounts* for the given company. */
async function mockAccounts(
  page: Page,
  companyId: string,
  state: { items: ReturnType<typeof account>[]; integration?: string },
) {
  const base = `/api/v1/companies/${companyId}/social-accounts`;
  await page.route(
    (url) => url.pathname.startsWith(base),
    async (route) => {
      const path = new URL(route.request().url()).pathname.slice(base.length);
      const method = route.request().method();
      if (method === "GET" && path === "")
        return json(
          route,
          {
            items: state.items,
            connected_count: state.items.filter((a) =>
              ["connected", "limited"].includes(String(a.status)),
            ).length,
            publishing_enabled: false,
          },
          page,
        );
      if (method === "GET" && path === "/platforms")
        return json(route, platformsFixture(state.integration), page);
      if (method === "POST" && path === "/linkedin/connect")
        return json(
          route,
          {
            authorization_url:
              "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=fixture&state=fixture",
            expires_at: "2026-11-19T06:40:00Z",
          },
          page,
        );
      if (method === "POST" && path.endsWith("/disconnect")) {
        const disconnected = account(companyId, {
          status: "disconnected",
          disconnected_at: "2026-11-19T07:00:00Z",
        });
        state.items = [];
        return json(
          route,
          {
            account: disconnected,
            provider_access_revoked: false,
            guidance:
              "SocialAI deleted its stored LinkedIn credential. Remove the app in LinkedIn Settings → Data privacy → Permitted services.",
          },
          page,
        );
      }
      return route.continue();
    },
  );
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("real backend: honest LinkedIn configuration state and inactive platforms", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  const catalog = await (
    await page.request.get(`${apiURL}/companies/${companyId}/social-accounts/platforms`)
  ).json();
  const linkedin = catalog.items.find((p: { slug: string }) => p.slug === "linkedin");
  expect(catalog.publishing_enabled).toBe(false);
  const list = await (await page.request.get(`${apiURL}/companies/${companyId}/social-accounts`)).json();
  expect(list.items).toEqual([]); // no fabricated accounts for a new company
  await page.goto("/dashboard/accounts");
  await expect(page.getByRole("heading", { name: "Social Accounts", exact: true })).toBeVisible();
  await expect(
    page.getByText("Connect and manage the social profiles where your brand will publish content."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your LinkedIn account" })).toBeVisible();
  await expect(page.getByText(/No social accounts are connected for/)).toBeVisible();
  const connect = page.getByRole("button", { name: "Connect LinkedIn" });
  if (linkedin.integration === "configuration_required") {
    await expect(connect).toBeDisabled();
    await expect(page.getByText("LinkedIn is not configured on this server yet.")).toBeVisible();
    for (const issue of linkedin.configuration_issues)
      await expect(page.getByText(issue, { exact: true })).toBeVisible();
  } else {
    await expect(connect).toBeEnabled();
  }
  for (const name of ["Instagram", "Facebook", "X"]) {
    const card = page.getByRole("article", { name: `${name} (coming later)` });
    await expect(card.getByText("Coming later")).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
  }
  await expect(page.getByText("Publishing is not enabled in this release.", { exact: false })).toBeVisible();
  await page.screenshot({ path: "artifacts/social-accounts-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect your LinkedIn account" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "artifacts/social-accounts-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  const checklist = page.getByRole("region", { name: "Setup checklist" });
  await checklist.getByRole("button", { name: "Checklist", exact: true }).click();
  await expect(checklist.getByRole("link", { name: "Connect social accounts (open)", exact: true })).toBeVisible();
});

test("real backend: forged callback is rejected with a fixed code and no echo", async ({ page }) => {
  await signInWorkspace(page);
  const response = await page.request.get(
    `${apiURL}/social-accounts/oauth/linkedin/callback?state=forged-state&code=SECRET-CODE-VALUE&error_description=%3Cscript%3E`,
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(303);
  const location = response.headers()["location"];
  expect(location).toMatch(/^http:\/\/localhost:300[01]\/dashboard\/accounts\?social=invalid_state&platform=linkedin$/);
  expect(location).not.toContain("SECRET-CODE-VALUE");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("UI fixture: limited LinkedIn connection, details, sidebar count and disconnect", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  await mockAccounts(page, companyId, { items: [account(companyId)] });
  await page.goto("/dashboard/accounts");
  const card = page.getByRole("article", { name: "LinkedIn connected" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Limited permissions")).toBeVisible();
  await expect(
    card.getByText("Your LinkedIn account is connected, but publishing permission is not currently available."),
  ).toBeVisible();
  await expect(card.getByText("Verified LinkedIn identity")).toBeVisible();
  await expect(page.locator(".sidebar").getByLabel("1 connected")).toBeVisible();
  const row = page.getByRole("listitem", { name: "Asha Rao (UI fixture) on LinkedIn" });
  await expect(row.getByText("No publishing permission")).toBeVisible();
  await expect(row.getByText("Personal profile", { exact: false })).toBeVisible();
  await page.screenshot({ path: "artifacts/social-accounts-connected-desktop.png", fullPage: true });
  await card.getByRole("button", { name: "View connection details" }).click();
  const details = page.getByRole("dialog", { name: "LinkedIn connection details" });
  await expect(details.getByText("email, openid, profile")).toBeVisible();
  await expect(details.getByText("Not available: reconnect before expiry")).toBeVisible();
  await expect(details).not.toContainText("token:");
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await page.setViewportSize({ width: 375, height: 812 });
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "artifacts/social-accounts-connected-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.getByRole("button", { name: "Disconnect" }).click();
  const confirm = page.getByRole("dialog", { name: "Disconnect Asha Rao (UI fixture)?" });
  await expect(confirm.getByText(/Existing posts and schedules are not changed/)).toBeVisible();
  await confirm.getByRole("button", { name: "Keep connection" }).click();
  await expect(confirm).toBeHidden();
  await card.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Permitted services" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your LinkedIn account" })).toBeVisible();
});

test("UI fixture: connect goes only to LinkedIn and callback outcomes are explained", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  await mockAccounts(page, companyId, { items: [] });
  // Test double: never contact the real LinkedIn from routine tests.
  await page.route("https://www.linkedin.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>LinkedIn consent (test double)</h1>" }),
  );
  await page.goto("/dashboard/accounts");
  await page.getByRole("button", { name: "Connect LinkedIn" }).click();
  await page.waitForURL(/^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\?/);
  await page.goto("/dashboard/accounts?social=cancelled&platform=linkedin");
  const notice = page.getByRole("status").filter({ hasText: "LinkedIn connection was cancelled" });
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(page).toHaveURL(/\/dashboard\/accounts$/);
  await expect(notice).toBeHidden();
  await page.goto("/dashboard/accounts?social=wrong_account&platform=linkedin");
  await expect(page.getByRole("alert").filter({ hasText: "different LinkedIn member" })).toBeVisible();
  await page.goto("/dashboard/accounts?social=not-a-real-code");
  await expect(page.locator(".social-notice")).toHaveCount(0);
});

test("UI fixture: company switching isolates connections and schedule screens show availability", async ({ page }) => {
  const { companyId, workspaceId } = await signInWorkspace(page);
  const second = await (
    await page.request.post(`${apiURL}/workspaces/${workspaceId}/companies`, {
      headers,
      data: { name: "Second social company", description: "An isolated second company for account checks." },
    })
  ).json();
  await mockAccounts(page, companyId, { items: [account(companyId)] });
  await page.goto("/dashboard/accounts");
  await expect(page.getByRole("article", { name: "LinkedIn connected" })).toBeVisible();
  await page.goto("/dashboard/calendar");
  await expect(page.getByRole("note", { name: "Social account availability" })).toContainText(
    "LinkedIn: Asha Rao (UI fixture) (limited permissions)",
  );
  await expect(page.getByRole("note", { name: "Social account availability" })).toContainText("Publishing is not enabled yet");
  await page.locator(".sidebar .workspace-button").click();
  await page.getByLabel("Active company").selectOption(second.id);
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/dashboard/accounts");
  await expect(page.getByRole("heading", { name: "Connect your LinkedIn account" })).toBeVisible();
  await expect(page.getByText("Asha Rao (UI fixture)")).toHaveCount(0);
  await expect(page.locator(".sidebar").getByLabel(/connected$/)).toHaveCount(0);
  await page.goto("/dashboard/posts");
  await expect(page.getByRole("note", { name: "Social account availability" })).toContainText(
    "No social accounts are connected for this company",
  );
});
