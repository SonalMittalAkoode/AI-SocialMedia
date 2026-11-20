import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { apiURL, testPassword, uniqueEmail } from "./auth-helpers";

const origin = process.env.SOCIALAI_E2E_BASE_URL || "http://localhost:3001";
const headers = { Origin: new URL(origin).origin };
const website = "https://ember-roasters.org/";
const directory = "artifacts/onboarding-3step";
const logo = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="136" height="72" viewBox="0 0 136 72"><rect width="136" height="72" fill="#f7ead9"/><path d="M32 56 Q14 46 47 13 Q45 30 57 40 Q61 56 45 61 Q37 64 32 56Z" fill="#8e311f"/><path d="M66 22h46v4H66zm0 12h36v4H66zm0 12h46v4H66z" fill="#183e35"/></svg>',
);

async function signIn(page: Page) {
  const email = uniqueEmail();
  const password = testPassword;
  const registration = await page.request.post(apiURL + "/auth/register", {
    headers,
    data: { full_name: "Ember Test Owner", email, password },
  });
  expect(registration.status()).toBe(201);
  const user = await registration.json();
  const login = async () => {
    const result = await page.request.post(apiURL + "/auth/login", {
      headers,
      data: { email, password },
    });
    expect(result.status()).toBe(200);
  };
  await login();
  return { user, login };
}

async function capture(page: Page, file: string) {
  await page.screenshot({
    path: `${directory}/${file}.png`,
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
  });
}

async function captureResponsive(page: Page, file: string) {
  await capture(page, `${file}-desktop`);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, `${file}-mobile`);
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("website-only setup preserves research, logo and edits, then recovers the first Studio draft", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { user, login } = await signIn(page);
  let researchPolls = 0;
  let researchStarts = 0;
  let releaseResearch = false;
  let releaseDraft = false;
  let finalizeCalls = 0;
  let companyId = "";
  const analysisId = "1d83d1a6-509a-4da0-8efa-1384e38e6d99";
  const readCompany = () => `${apiURL}/companies/${companyId}`;
  const job = (status: string, stage: string) => ({
    id: analysisId,
    company_id: companyId,
    requested_url: website,
    status,
    stage,
    attempt_count: 1,
    error_code: null,
    error_message: null,
    created_at: new Date().toISOString(),
  });

  await page.route("**/brand-extractions**", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    companyId = parts[4];
    if (parts.at(-1) === "result") {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    if (route.request().method() === "POST") {
      researchStarts += 1;
      expect(route.request().postDataJSON().url).toBe(website);
      await route.fulfill({ status: 202, json: job("queued", "queued") });
      return;
    }
    const current = releaseResearch
      ? job("completed", "completed")
      : job("running", "analyzing");
    if (parts.at(-1) === analysisId) {
      researchPolls += 1;
      await route.fulfill({ json: current });
    } else await route.fulfill({ json: researchStarts ? [current] : [] });
  });
  await page.route("**/onboarding/website-brand", async (route) => {
    const root = readCompany();
    const company = await (await page.request.get(root)).json();
    const brand = await (await page.request.get(root + "/brand")).json();
    const updated = await page.request.patch(root, {
      headers,
      data: {
        revision: company.revision,
        name: "Ember Roasters",
        industry: "Food & Beverage",
      },
    });
    expect(updated.ok()).toBeTruthy();
    const saved = await page.request.patch(root + "/brand", {
      headers,
      data: {
        revision: brand.revision,
        display_name: "Ember Roasters",
        source: "imported",
        description:
          "A neighbourhood coffee roastery offering small-batch beans and seasonal tastings.",
        products_services: ["Small-batch coffee beans", "Seasonal tastings"],
        brand_voice: ["Friendly"],
      },
    });
    expect(saved.ok()).toBeTruthy();
    await route.fulfill({ status: 204 });
  });
  await page.route("**/brand/logo/auto?**", async (route) => {
    const root = readCompany() + "/brand";
    const brand = await (await page.request.get(root)).json();
    const saved = await page.request.patch(root, {
      headers,
      data: {
        revision: brand.revision,
        brand_colors: ["#8e311f", "#183e35"],
      },
    });
    expect(saved.ok()).toBeTruthy();
    const colors = await saved.json();
    const uploaded = await page.request.post(
      root + "/logo/upload?revision=" + colors.revision,
      {
        headers: { ...headers, "Content-Type": "image/svg+xml" },
        data: logo,
      },
    );
    expect(uploaded.ok()).toBeTruthy();
    const refreshed = await (await page.request.get(root)).json();
    await route.fulfill({ json: { brand_revision: refreshed.revision } });
  });

  await page.goto("/onboarding/business");
  await expect(
    page.getByRole("heading", { name: "Let's get to know your business." }),
  ).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(
    0,
  );
  await captureResponsive(page, "step-1-website");
  await page
    .getByLabel("Business website", { exact: true })
    .fill("ember-roasters.org");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Analyzing your business", { exact: true }),
  ).toBeVisible();
  await capture(page, "step-1-analysis-progress");
  await page.reload();
  await expect(
    page.getByRole("progressbar", { name: "Website analysis progress" }),
  ).toBeVisible();
  await expect.poll(() => researchPolls).toBeGreaterThan(1);
  expect(researchStarts).toBe(1);
  releaseResearch = true;
  await expect(page).toHaveURL(/\/onboarding\/brand$/);
  const summary = page.getByRole("region", { name: "Brand summary" });
  await expect(
    summary.getByRole("heading", { name: "Ember Roasters" }),
  ).toBeVisible();
  await expect(
    summary.getByRole("img", { name: "Ember Roasters logo" }),
  ).toBeVisible();
  await expect(summary.getByText("Audience not identified yet.")).toBeVisible();
  await captureResponsive(page, "step-2-brand");
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit brand details" }),
  ).toBeVisible();
  await capture(page, "step-2-edit-details");
  await page
    .getByLabel("Target audience", { exact: true })
    .fill("Local coffee lovers and home brewers");
  await page.getByLabel("Brand color HEX 1", { exact: true }).fill("#743525");
  await page.getByLabel("Brand color HEX 1", { exact: true }).blur();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    summary.getByText("Local coffee lovers and home brewers"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page
    .getByLabel("Target audience", { exact: true })
    .fill("Discard this change");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(summary.getByText("Discard this change")).toHaveCount(0);
  await page.reload();
  await expect(
    summary.getByText("Local coffee lovers and home brewers"),
  ).toBeVisible();
  expect(
    (await (await page.request.get(readCompany() + "/brand")).json())
      .brand_colors,
  ).toContain("#743525");
  await page.getByRole("button", { name: "Looks good" }).click();
  await expect(page).toHaveURL(/\/onboarding\/goals$/);
  await expect(page.getByRole("radio", { name: "Friendly" })).toBeChecked();
  await page
    .getByRole("radio", { name: "Get more leads and customers" })
    .check();
  await page.getByRole("checkbox", { name: "LinkedIn" }).check();
  await page.getByRole("radio", { name: "Bold" }).check();
  await captureResponsive(page, "step-3-goals");

  const backend = path.resolve(process.cwd(), "../backend");
  const savedFixture = JSON.parse(
    execFileSync(
      path.join(backend, ".venv/Scripts/python.exe"),
      [
        "scripts/seed_crm_browser_generation.py",
        companyId,
        user.id,
        "--first-post",
      ],
      { cwd: backend, encoding: "utf8" },
    ),
  );
  const durableJob = await (
    await page.request.get(readCompany() + "/ai-jobs/" + savedFixture.job_id)
  ).json();
  await page.route(`**/ai-jobs/${savedFixture.job_id}`, (route) =>
    route.fulfill({
      json: releaseDraft
        ? durableJob
        : {
            ...durableJob,
            status: "running",
            stage: "generating",
            completed_at: null,
          },
    }),
  );
  await page.route("**/onboarding/finalize", async (route) => {
    finalizeCalls += 1;
    const result = await route.fetch();
    await route.fulfill({ response: result });
  });
  const mediaJob = {
    ...durableJob,
    kind: "image_generation",
    status: "failed",
    stage: "failed",
    result_index: 0,
    aspect_ratio: "4:5",
    error_message: "The image provider did not respond in time.",
  };
  await page.route(
    `**/content-generations/${savedFixture.job_id}/media`,
    (route) =>
      route.fulfill({
        json: { assets: [], jobs: [mediaJob] },
      }),
  );
  await page.getByRole("button", { name: "Generate my first post" }).dblclick();
  await expect(page).toHaveURL(/\/dashboard\/content-studio\?first=1/);
  await expect(
    page.getByRole("progressbar", { name: "First post generation progress" }),
  ).toBeVisible();
  await capture(page, "studio-first-post-generating");
  await page.reload();
  await expect(
    page.getByRole("progressbar", { name: "First post generation progress" }),
  ).toBeVisible();
  await page.request.post(apiURL + "/auth/logout", { headers, data: {} });
  await login();
  await page.reload();
  await expect(
    page.getByRole("progressbar", { name: "First post generation progress" }),
  ).toBeVisible();
  expect(finalizeCalls).toBe(1);
  releaseDraft = true;
  await expect(page.getByText("First post ready to review")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Instagram" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "LinkedIn" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Image generation failed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled();
  await capture(page, "studio-first-post-completed");
  expect(
    await (await page.request.get(readCompany() + "/preferences")).json(),
  ).toMatchObject({
    content_goals: ["lead_generation"],
    platforms: ["instagram", "linkedin"],
    tone: ["bold"],
  });
  expect(
    (await (await page.request.get(readCompany() + "/onboarding")).json())
      .status,
  ).toBe("completed");
  await page.goto("/dashboard");
  const checklist = page.getByRole("region", { name: "Setup checklist" });
  await expect(checklist).toBeVisible();
  await checklist.getByRole("button", { name: "Checklist", exact: true }).click();
  await expect(
    checklist.getByRole("link", { name: /Set up your brand.*complete/ }),
  ).toBeVisible();
  await expect(
    checklist.getByRole("link", { name: /Create your first post.*open/ }),
  ).toBeVisible();
  await capture(page, "crm-optional-setup-checklist");
  await checklist
    .getByRole("button", { name: "Dismiss setup checklist" })
    .click();
  await page.reload();
  await expect(checklist).toHaveCount(0);
});

test("blocked website retains its URL and offers a persistent manual alternative", async ({
  page,
}) => {
  await signIn(page);
  let companyId = "";
  await page.route("**/brand-extractions**", (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    companyId = parts[4];
    return route.fulfill({
      status: 202,
      json: {
        id: "1d83d1a6-509a-4da0-8efa-1384e38e6d95",
        company_id: companyId,
        requested_url: website,
        status: "failed",
        stage: "failed",
        attempt_count: 1,
        error_code: "restricted",
        error_message: "This website restricts automated access.",
        created_at: new Date().toISOString(),
      },
    });
  });
  await page.goto("/onboarding/business");
  await page.getByLabel("Business website", { exact: true }).fill(website);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "We couldn't fully analyze that website.",
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Business website", { exact: true }),
  ).toHaveValue(website);
  await capture(page, "step-1-analysis-error");
  await page
    .getByRole("button", { name: "Enter details manually", exact: true })
    .click();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Maple Street Bakery");
  await page
    .getByLabel("One-line business description")
    .fill("Independent bakery offering sourdough and seasonal pastries.");
  await capture(page, "step-1-manual");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/brand$/);
  await expect(
    page.getByRole("heading", { name: "Review your brand." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Maple Street Bakery" }),
  ).toBeVisible();
  await expect(page.getByText("Brand colors not found.")).toBeVisible();
  expect(
    await (await page.request.get(`${apiURL}/companies/${companyId}`)).json(),
  ).toMatchObject({
    name: "Maple Street Bakery",
    website_url: website,
  });
});
