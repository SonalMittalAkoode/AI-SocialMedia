import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";

// Research results come from a labelled fixture (no provider call). The live
// "Research selected" run targets a site that refuses automated access, so it
// fails at the fetch step without any Gemini request.
test("bulk add, research results, approval, edit, removal and progress persist", async ({
  page,
}) => {
  const { companyId, id } = await signInWorkspace(page);
  await page.goto("/dashboard/competitors");
  await page.getByRole("button", { name: "Add competitor", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Bulk add" }).click();
  await expect(
    dialog.getByLabel("Research automatically after saving (uses Gemini quota)"),
  ).toBeChecked();
  await dialog
    .getByLabel("Research automatically after saving (uses Gemini quota)")
    .uncheck();
  await dialog
    .getByLabel("Competitors, one per line (Name, https://website)")
    .fill(
      "Fixture Roasters, https://www.iana.org\nhttps://iana.org/about\nRestricted Fixture, https://business.org",
    );
  await expect(dialog.getByText("3 websites detected", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Save 3 competitors" }).click();
  await expect(dialog.getByText("Save results")).toBeVisible();
  await expect(dialog.getByText("invalid", { exact: true })).toBeVisible();
  await expect(dialog.getByText("created", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Fixture Roasters" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Restricted Fixture" })).toBeVisible();

  const rows = await (
    await page.request.get(`${apiURL}/companies/${companyId}/competitors`)
  ).json();
  const fixture = rows.find((r: { name: string }) => r.name === "Fixture Roasters");
  const backend = path.resolve(process.cwd(), "../backend");
  execFileSync(
    path.join(backend, ".venv/Scripts/python.exe"),
    ["scripts/seed_competitor_research_fixture.py", companyId, id, fixture.id],
    { cwd: backend, encoding: "utf8" },
  );

  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "Fixture Roasters" });
  await expect(row.getByText("verified", { exact: true })).toBeVisible();
  await expect(row.getByText("researched", { exact: true })).toBeVisible();
  await expect(row.getByLabel("Relevance 58 of 100")).toBeVisible();

  await page.getByRole("button", { name: "View Fixture Roasters" }).click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("Research insights")).toBeVisible();
  await expect(detail.getByText(/positions itself as an approachable/)).toBeVisible();
  await expect(detail.getByText("Show your roasting process step by step")).toBeVisible();
  await expect(detail.getByText(/Based on: “Single-origin beans”/)).toBeVisible();
  await expect(detail.getByText("Source evidence (1)")).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Reanalyze website" }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Edit details" }).click();
  await detail.getByLabel("Industry").fill("Specialty coffee");
  await detail.getByRole("button", { name: "Save competitor details" }).click();
  await expect(detail.getByRole("button", { name: "Edit details" })).toBeVisible();
  await detail.getByRole("button", { name: "Close dialog" }).click();
  await expect(row.getByText("Specialty coffee")).toBeVisible();

  await row.getByRole("button", { name: "Approve competitor" }).click();
  await expect(row.getByText("approved", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Competitor summary").getByText("Informing AI content"),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Competitor summary")
      .locator("div", { hasText: "Informing AI content" })
      .locator("strong"),
  ).toHaveText("1");

  // Removal is soft and reversible; history stays.
  await page.getByRole("button", { name: "View Restricted Fixture" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove competitor" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("heading", { name: "Restricted Fixture" })).toHaveCount(0);
  await page.getByLabel("Show").selectOption("removed");
  await page
    .getByRole("row")
    .filter({ hasText: "Restricted Fixture" })
    .getByRole("button", { name: "Restore" })
    .click();
  await page.getByLabel("Show").selectOption("active");
  await expect(page.getByRole("heading", { name: "Restricted Fixture" })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/competitor-intelligence-desktop.png", fullPage: true });

  // Real research admission + worker progress, ending in a handled failure.
  await page.getByLabel("Select Restricted Fixture").check();
  await page.getByRole("button", { name: "Research selected (1)" }).click();
  await expect(page.getByLabel("Research progress", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Research progress", { exact: true })).toBeVisible();
  const restricted = page.getByRole("row").filter({ hasText: "Restricted Fixture" });
  await expect(restricted.getByText("failed", { exact: true })).toBeVisible({
    timeout: 90000,
  });
  await expect(page.getByText(/1 failed/)).toBeVisible();
  await expect(row.getByText("approved", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fixture Roasters" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/competitor-intelligence-mobile.png", fullPage: true });
});
