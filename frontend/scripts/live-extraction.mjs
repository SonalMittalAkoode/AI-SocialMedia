// Explicit opt-in smoke test. Never included in CI or the default browser suite.
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
if (process.env.RUN_LIVE_EXTRACTION !== "1")
  throw new Error("Set RUN_LIVE_EXTRACTION=1 to authorize live Gemini usage.");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ reducedMotion: "reduce" });
const page = await context.newPage();
const root = "http://localhost:8000/api/v1";
const headers = { Origin: "http://localhost:3000" };
async function post(path, data) {
  const response = await context.request.post(root + path, { headers, data });
  if (!response.ok())
    throw new Error(`Smoke API request failed with HTTP ${response.status()}`);
  return response.json();
}
try {
  const email = `live-browser-${randomUUID()}@example.com`;
  const password = `Smoke123!${randomUUID()}`;
  const user = await post("/auth/register", {
    full_name: "Live Browser Smoke",
    email,
    password,
  });
  await post("/auth/login", { email, password });
  const workspace = await post("/workspaces", {
    name: "Live browser research",
  });
  const company = await post(`/workspaces/${workspace.id}/companies`, {
    name: "Website research review",
    website_url: process.argv[2] || "https://basecamp.com",
  });
  await page.addInitScript(
    ({ userId, workspaceId, companyId }) =>
      localStorage.setItem(
        `socialai-active:${userId}`,
        JSON.stringify({ workspaceId, companyId }),
      ),
    { userId: user.id, workspaceId: workspace.id, companyId: company.id },
  );
  await page.goto("http://localhost:3000/onboarding/business");
  await page
    .getByRole("button", { name: "Analyze my business", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review findings before applying" }),
  ).toBeVisible({ timeout: 120000 });
  await page.locator("summary").filter({ hasText: "Business name ·" }).click();
  await page.getByLabel("Apply business name", { exact: true }).check();
  await page.locator("summary").filter({ hasText: "Description ·" }).click();
  await page.getByLabel("Apply description", { exact: true }).check();
  const name = await page
    .getByLabel("Finding: Business name", { exact: true })
    .inputValue();
  const description = await page
    .getByLabel("Finding: Description", { exact: true })
    .inputValue();
  expect(name.length).toBeGreaterThan(1);
  expect(description.length).toBeGreaterThan(9);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/live-extraction-${width}.png`,
      fullPage: true,
    });
  }
  const before = await (
    await context.request.get(`${root}/companies/${company.id}/brand`)
  ).json();
  expect(before.display_name).toBe("Website research review");
  await page.getByRole("button", { name: "Apply selected findings" }).click();
  await expect(page).toHaveURL(/onboarding\/brand/);
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    name,
  );
  await page.reload();
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    name,
  );
  await page.getByRole("button", { name: "Confirm brand identity" }).click();
  await expect(page).toHaveURL(/onboarding\/competitors/);
  const brand = await (
    await context.request.get(`${root}/companies/${company.id}/brand`)
  ).json();
  expect(brand.is_confirmed).toBe(true);
  console.log(
    JSON.stringify({
      liveBrowserPassed: true,
      companyId: company.id,
      preservedBeforeApproval: true,
      selectedFieldsApplied: true,
      refreshed: true,
      confirmed: true,
      mobileAndDesktop: true,
    }),
  );
} finally {
  await browser.close();
}
