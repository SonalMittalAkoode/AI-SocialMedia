import { test, expect } from "@playwright/test";
import { signInWorkspace, testPassword, apiURL } from "./auth-helpers";
import { initialState } from "../../src/data/fixtures";
import { serializeState, STORAGE_KEY } from "../../src/lib/storage";
import { companyCacheKey } from "../../src/lib/company-state";
test("unfinished company setup does not block login or CRM deep links", async ({
  page,
}) => {
  const { email, workspaceId } = await signInWorkspace(page);
  const response = await page.request.post(
    `${apiURL}/workspaces/${workspaceId}/companies`,
    {
      headers: { Origin: "http://localhost:3000" },
      data: { name: "Unfinished login company" },
    },
  );
  expect(response.status()).toBe(201);
  const company = await response.json();
  const progressURL = `${apiURL}/companies/${company.id}/onboarding`;
  const before = await (await page.request.get(progressURL)).json();
  await page.goto("/dashboard");
  await page.locator(".sidebar .workspace-button").click();
  await page.getByLabel("Active company").selectOption(company.id);
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("link", { name: "Continue company setup" }),
  ).toBeVisible();
  await page.request.post(`${apiURL}/auth/logout`, {
    headers: { Origin: "http://localhost:3000" },
    data: {},
  });
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Log in to your workspace" }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Your creative workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue company setup" }),
  ).toBeVisible();
  await page.goto("/dashboard/posts");
  await page.reload();
  await expect(page).toHaveURL("/dashboard/posts");
  await expect(
    page.getByRole("heading", { name: "Post Library", exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the dashboard" }).click();
  await expect(page).toHaveURL("/dashboard");
  expect(await (await page.request.get(progressURL)).json()).toEqual(before);
  await page.getByRole("link", { name: "Continue company setup" }).click();
  await expect(page).toHaveURL("/onboarding/business");
  await page.getByRole("button", { name: /No website/ }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    company.name,
  );
  await page.getByRole("link", { name: "Save & exit" }).click();
  await expect(page).toHaveURL("/dashboard");
});

test("localStorage cannot grant protected access, including the old demo button", async ({
  page,
}) => {
  const forged = initialState();
  forged.authenticated = true;
  forged.user = { name: "Forged", email: "forged@example.com" };
  forged.onboarding.completed = true;
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key: STORAGE_KEY,
    raw: serializeState(forged),
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
  await page.goto("/onboarding/business");
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the dashboard" }).click();
  await expect(page).toHaveURL("/login");
});
test("signup validation, duplicate email, and invalid login errors appear in the existing form", async ({
  page,
}) => {
  const { email } = await signInWorkspace(page);
  await page.request.post(`${apiURL}/auth/logout`, {
    headers: { Origin: "http://localhost:3000" },
    data: {},
  });
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create your free account" }).click();
  await expect(
    page.getByText("Use a full name between 2 and 150 characters."),
  ).toBeVisible();
  await page.getByLabel("Full name").fill("Duplicate Test");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByLabel("Confirm password").fill(testPassword);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create your free account" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Email already registered" }),
  ).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("WrongPassword123!");
  await page.getByRole("button", { name: "Log in to your workspace" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid email or password" }),
  ).toBeVisible();
});
test("cookie restores the session, failed logout retains it, and successful logout denies access", async ({
  page,
  context,
}) => {
  await signInWorkspace(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Your creative workspace/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Your creative workspace/ }),
  ).toBeVisible();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "access_token",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "access_token",
  );
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain(testPassword);
  await page.goto("/dashboard/settings");
  await page.route("**/auth/logout", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"detail":"Unavailable"}',
    }),
  );
  await page
    .getByRole("button", { name: "Log out", exact: true })
    .last()
    .click();
  await expect(page.getByRole("status")).toContainText(
    "temporarily unavailable",
  );
  await expect(page).toHaveURL("/dashboard/settings");
  await page.unroute("**/auth/logout");
  await page
    .getByRole("button", { name: "Log out", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL("/login");
  expect((await page.request.get(`${apiURL}/auth/me`)).status()).toBe(401);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
});
test("expired session clears auth while leaving local workspace data intact", async ({
  page,
}) => {
  const { id, companyId } = await signInWorkspace(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Your creative workspace/ }),
  ).toBeVisible();
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    companyCacheKey(id, companyId),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: '{"detail":"Invalid session"}',
    }),
  );
  await page.reload();
  await expect(page).toHaveURL("/login");
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      companyCacheKey(id, companyId),
    ),
  ).toBe(before);
});
test("API unavailable offers retry without flashing protected content", async ({
  page,
}) => {
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"detail":"Unavailable"}',
    }),
  );
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "We couldn’t verify your session." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Your creative workspace/ }),
  ).toHaveCount(0);
});
