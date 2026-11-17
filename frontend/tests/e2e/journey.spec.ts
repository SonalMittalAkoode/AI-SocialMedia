import { test, expect } from "@playwright/test";
import { uniqueEmail, signInWorkspace } from "./auth-helpers";
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
    .getByRole("button", { name: /Continue with .* competitors/ })
    .click();
  await expect(page).toHaveURL(/onboarding\/preferences/);
  await page
    .getByRole("button", { name: "Generate my first post", exact: true })
    .click();
  await expect(page).toHaveURL(/onboarding\/generate/);
  await page
    .getByRole("button", { name: "Generate my first posts", exact: true })
    .click();
  await expect(page.getByLabel("Caption", { exact: true })).toBeVisible();
  await page
    .getByLabel("Post title", { exact: true })
    .fill("A morning worth sharing");
  await page
    .getByLabel("Caption", { exact: true })
    .fill("Fresh coffee. A fresh start. Welcome to Sam’s Cafe.");
  await page
    .getByRole("button", { name: "Save as draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Complete onboarding" }).click();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Workspace overview/ }),
  ).toBeVisible();
  await page.goto("/dashboard/posts");
  await page.getByRole("button", { name: "View browser demo drafts" }).click();
  await page
    .getByRole("button", { name: "Preview A morning worth sharing" })
    .click();
  await page.getByLabel("Post title", { exact: true }).fill("Our next chapter");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "View browser demo drafts" }).click();
  await expect(
    page.getByRole("heading", { name: "Our next chapter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview Our next chapter" }).click();
  await page.getByLabel(/Planned date & time/).fill("2026-11-18T09:30");
  await page.getByRole("button", { name: "Plan locally", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Post planned locally");
  await page.goto("/dashboard/calendar");
  await page
    .getByRole("button", { name: "View demo calendar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Instagram.*Our next chapter/ }),
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
  await page.getByRole("button", { name: "View browser demo drafts" }).click();
  await expect(
    page.getByRole("heading", { name: "Our next chapter" }),
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
test("simulated generation can fail and retry without losing configuration", async ({
  page,
}) => {
  await signInWorkspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the dashboard" }).click();
  await page.goto("/dashboard/content-studio");
  await page.getByRole("button", { name: "Use demo templates" }).click();
  await page.getByLabel(/What.*the story/).fill("Our winter menu");
  await page.getByLabel("Test a simulated error").check();
  await page.getByRole("button", { name: "Generate my first posts" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The demo generation was interrupted" }),
  ).toContainText("Please try again");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Post title", { exact: true })).toHaveValue(
    "Our winter menu",
  );
});
