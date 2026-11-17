import { test, expect } from "@playwright/test";
import { uniqueEmail, signInWorkspace, apiURL } from "./auth-helpers";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { addDays, dayInZone } from "../../src/lib/scheduling-api";
async function mockRealGeneration(page: import("@playwright/test").Page) {
  await page.route("**/content-generations", async (route) => {
    const user = await (await page.request.get(`${apiURL}/auth/me`)).json();
    const spaces = await (
      await page.request.get(`${apiURL}/workspaces`)
    ).json();
    const companies = await (
      await page.request.get(`${apiURL}/workspaces/${spaces[0].id}/companies`)
    ).json();
    const backend = path.resolve(process.cwd(), "../backend");
    const seeded = JSON.parse(
      execFileSync(
        path.join(backend, ".venv/Scripts/python.exe"),
        ["scripts/seed_crm_browser_generation.py", companies[0].id, user.id],
        { cwd: backend, encoding: "utf8" },
      ),
    );
    const job = await (
      await page.request.get(
        `${apiURL}/companies/${companies[0].id}/ai-jobs/${seeded.job_id}`,
      )
    ).json();
    await route.fulfill({ status: 202, json: job });
  });
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T04:30:00Z"));
});
test("complete onboarding, persist an edited draft, schedule, and return after logout", async ({
  page,
}) => {
  const errors: string[] = [];
  const email = uniqueEmail();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Sam Taylor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("DemoPassword123");
  await page.getByLabel("Confirm password").fill("DemoPassword123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create your free account" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("DemoPassword123");
  await page.getByRole("button", { name: "Log in to your workspace" }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Workspace overview" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Set up company", exact: true }).click();
  await expect(page).toHaveURL(/onboarding\/business/);
  await page.getByLabel("Business name *", { exact: true }).fill("Sam’s Cafe");
  await page
    .getByLabel("What do you do? (optional)")
    .fill("A thoughtful neighborhood cafe serving specialty coffee.");
  await page
    .getByLabel("Business website or social profile URL")
    .fill("https://sams.example");
  // Fictional URLs cannot be researched; keep the mock-content regression on the manual path.
  await page.getByRole("button", { name: "Enter details manually" }).click();
  await expect(page).toHaveURL(/onboarding\/brand/);
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    "Sam’s Cafe",
  );
  await page.reload();
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    "Sam’s Cafe",
  );
  await page.getByRole("button", { name: "Confirm brand identity" }).click();
  await expect(page).toHaveURL(/onboarding\/competitors/);
  await page
    .getByRole("button", { name: "Continue to preferences" })
    .click();
  await expect(page).toHaveURL(/onboarding\/preferences/);
  await page
    .getByRole("button", { name: "Generate my first post", exact: true })
    .click();
  await expect(page).toHaveURL(/onboarding\/generate/);
  await mockRealGeneration(page);
  await page.getByLabel("What's the story?").fill("Our team and community");
  await page
    .getByRole("button", { name: "Generate content", exact: true })
    .click();
  await expect(page.getByLabel("Caption", { exact: true })).toBeVisible();
  await page
    .getByLabel("Post title", { exact: true })
    .fill("A morning worth sharing");
  await page
    .getByLabel("Caption", { exact: true })
    .fill("Fresh coffee and a thoughtful team. Welcome to our cafe.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete onboarding", exact: true })
    .click();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/dashboard/posts");
  await page
    .getByRole("button", { name: "Edit A morning worth sharing", exact: true })
    .click();
  await page.getByLabel("Post title", { exact: true }).fill("Our next chapter");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Approve saved draft", exact: true })
    .click();
  await page
    .getByLabel("Schedule date", { exact: true })
    .fill(addDays(dayInZone(new Date(), "Asia/Kolkata"), 14));
  await page
    .getByRole("button", { name: "Confirm schedule", exact: true })
    .click();
  await expect(
    page.getByText("Post scheduled in your company calendar.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Our next chapter", exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard/calendar");
  await expect(
    page.getByRole("button", { name: /View schedule Our next chapter/ }),
  ).toBeVisible();
  for (const route of [
    "competitors",
    "brand",
    "accounts",
    "analytics",
    "settings",
    "content-studio",
  ]) {
    await page.goto(`/dashboard/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
  }
  await page.goto("/dashboard/settings");
  await page
    .getByRole("button", { name: "Log out", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("DemoPassword123");
  await page.getByRole("button", { name: "Log in to your workspace" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/dashboard/posts");
  await expect(
    page.getByRole("button", { name: "Edit Our next chapter" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("responsive demo screens have no horizontal overflow", async ({
  page,
}) => {
  // Sweep 32 route loads plus dashboard captures against the existing dev server.
  test.setTimeout(120000);
  await signInWorkspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the dashboard" }).click();
  await expect(page).toHaveURL("/dashboard");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/",
      "/dashboard",
      "/dashboard/posts",
      "/dashboard/companies",
      "/dashboard/content-studio",
      "/dashboard/calendar",
      "/dashboard/brand",
      "/dashboard/settings",
    ]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${path} at ${width}px`,
      ).toBe(true);
    }
    await page.goto("/dashboard");
    await expect(page.locator(".crm-kpi")).toHaveCount(10);
    await expect(page.locator(".crm-kpis")).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: `artifacts/dashboard-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/");
  await page.screenshot({ path: "artifacts/landing.png", fullPage: true });
});
test("real generation failure preserves configuration and allows explicit retry", async ({
  page,
}) => {
  await signInWorkspace(page);
  await mockRealGeneration(page);
  await page.route("**/content-generations", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Gemini temporarily unavailable. No template fallback." },
    }),
  );
  await page.goto("/dashboard/content-studio");
  await page.getByLabel("What's the story?").fill("Our winter menu");
  await page
    .getByRole("button", { name: "Generate content", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Gemini temporarily unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel("What's the story?")).toHaveValue(
    "Our winter menu",
  );
  await expect(page.getByLabel("Test a simulated error")).toHaveCount(0);
  await page.unroute("**/content-generations");
  await mockRealGeneration(page);
  await page
    .getByRole("button", { name: "Generate content", exact: true })
    .click();
  await expect(page.getByLabel("Post title", { exact: true })).toHaveValue(
    "CRM browser recovery fixture",
  );
});
