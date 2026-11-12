import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T04:30:00Z"));
});
test("complete onboarding, persist an edited draft, schedule, and return after logout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Sam Taylor");
  await page.getByLabel("Work email").fill("sam@example.com");
  await page.getByLabel("Password", { exact: true }).fill("DemoPassword123");
  await page.getByLabel("Confirm password").fill("DemoPassword123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create your free account" }).click();
  await expect(page).toHaveURL(/onboarding\/business/);
  await page
    .getByLabel("Business name (optional)", { exact: true })
    .fill("Sam’s Cafe");
  await page
    .getByLabel("Business website or social profile URL")
    .fill("https://sams.example");
  await page.getByRole("button", { name: "Analyze my business" }).click();
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
    page.getByRole("heading", { name: /Good morning, Sam/ }),
  ).toBeVisible();
  await page.goto("/dashboard/posts");
  await page
    .getByRole("button", { name: "Preview A morning worth sharing" })
    .click();
  await page.getByLabel("Post title", { exact: true }).fill("Our next chapter");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Our next chapter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview Our next chapter" }).click();
  await page.getByLabel(/Planned date & time/).fill("2026-11-18T09:30");
  await page.getByRole("button", { name: "Plan locally", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Post planned locally");
  await page.goto("/dashboard/calendar");
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
  await page.getByLabel("Work email").fill("sam@example.com");
  await page.getByLabel("Password", { exact: true }).fill("DemoPassword123");
  await page.getByRole("button", { name: "Log in to your workspace" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/dashboard/posts");
  await expect(
    page.getByRole("heading", { name: "Our next chapter" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("responsive demo screens have no horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the dashboard" }).click();
  await expect(page).toHaveURL("/dashboard");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/",
      "/dashboard",
      "/dashboard/posts",
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
    await expect(page.locator('.welcome-banner')).toHaveCSS('opacity','1');
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
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the dashboard" }).click();
  await page.goto("/dashboard/content-studio");
  await page.getByLabel("What’s the story?").fill("Our winter menu");
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
