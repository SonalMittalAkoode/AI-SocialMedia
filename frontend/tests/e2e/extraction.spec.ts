import { test, expect, type Page } from "@playwright/test";
import { signInWorkspace } from "./auth-helpers";
const jobId = "3d7124be-eed1-4f49-bf09-bb4a6b083a19";
async function fixture(
  page: Page,
  mode: "success" | "failure" | "offline" = "success",
) {
  const { companyId } = await signInWorkspace(page);
  let started = false,
    polls = 0,
    applied: unknown = null;
  const job = () => ({
    id: jobId,
    company_id: companyId,
    requested_url: "https://business.org",
    status:
      mode === "failure" ? "failed" : polls >= 2 ? "completed" : "running",
    stage:
      mode === "failure" ? "failed" : polls >= 2 ? "completed" : "analyzing",
    attempt_count: 1,
    error_code: mode === "failure" ? "restricted" : null,
    error_message:
      mode === "failure" ? "The website restricts automated access." : null,
    created_at: new Date().toISOString(),
  });
  const data = {
    company_name: "Retrieved Business",
    description: "A retrieved business description backed by supplied text.",
    industry: null,
    business_type: null,
    tagline: null,
    target_audience: [],
    products_services: ["Engineering"],
    brand_voice: [],
    brand_keywords: [],
    brand_colors: [],
    social_links: {},
    city: null,
    country: null,
    value_proposition: "Helpful services",
    content_pillars: [],
    suggested_content_tone: [],
    overall_confidence: "medium",
    field_evidence: [
      {
        field: "company_name",
        value: "Retrieved Business",
        source_url: "https://business.org",
        supporting_text: "Retrieved Business",
        classification: "explicit",
        confidence: "high",
      },
    ],
    warnings: ["Review all findings before use."],
  };
  await page.route("**/brand-extractions**", async (route) => {
    if (mode === "offline") {
      await route.abort();
      return;
    }
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path.endsWith("/apply")) {
      applied = route.request().postDataJSON();
      await route.fulfill({ json: { company_revision: 2, brand_revision: 4 } });
      return;
    }
    if (path.endsWith("/result")) {
      await route.fulfill({
        json: {
          id: jobId,
          job_id: jobId,
          company_id: companyId,
          extracted_data: data,
          source_evidence: data.field_evidence,
          source_pages: [{ url: "https://business.org", title: "Business" }],
          warnings: data.warnings,
          model_identifier: "mocked-gemini",
        },
      });
      return;
    }
    if (route.request().method() === "POST") {
      started = true;
      polls = 0;
      await route.fulfill({
        status: 202,
        json: { ...job(), status: "queued", stage: "queued" },
      });
      return;
    }
    if (path.endsWith(jobId)) {
      polls++;
      await route.fulfill({ json: job() });
      return;
    }
    await route.fulfill({ json: started ? [job()] : [] });
  });
  return {
    companyId,
    getApplied: () => applied,
    startRestored: () => {
      started = true;
      polls = 0;
    },
  };
}
test("real analysis UI polls, restores after refresh, and applies only selected edited findings", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/dashboard/brand");
  await page
    .getByText("Research website and review previous findings", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Analyze my business", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Analysis:" }),
  ).toContainText(/queued|analyzing/);
  await page.reload();
  await page
    .getByText("Research website and review previous findings", { exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review findings before applying" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply selected findings" }),
  ).toBeDisabled();
  await page.locator("summary").filter({ hasText: "Business name ·" }).click();
  await page
    .getByLabel("Finding: Business name", { exact: true })
    .fill("Reviewed edited business");
  await page.getByLabel("Apply business name", { exact: true }).check();
  await expect(
    page.getByRole("link", { name: "Source", exact: true }),
  ).toHaveAttribute("href", "https://business.org");
  await page.getByRole("button", { name: "Apply selected findings" }).click();
  await expect(
    page.getByRole("heading", { name: "Applied successfully" }),
  ).toBeVisible();
  expect(f.getApplied()).toMatchObject({
    fields: { company_name: "Reviewed edited business" },
  });
  expect(Object.keys((f.getApplied() as { fields: object }).fields)).toEqual([
    "company_name",
  ]);
});
test("failed extraction offers retry and manual onboarding without fictional findings", async ({
  page,
}) => {
  await fixture(page, "failure");
  await page.goto("/onboarding/business");
  await page
    .getByRole("button", { name: "Analyze my business", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "restricts automated access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry analysis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review findings before applying" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Enter details manually" }).click();
  await expect(page).toHaveURL(/onboarding\/brand/);
});
test("lost connection preserves the server job and provides status retry at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await fixture(page, "offline");
  await page.goto("/onboarding/business");
  await page
    .getByRole("button", { name: "Analyze my business", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "server job is retained" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry status" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
