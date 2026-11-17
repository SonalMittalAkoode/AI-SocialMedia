import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";

// Grounded answer fixture (provider mocked). Research findings come from a labelled
// fixture (no provider call). Live research targets a site that refuses automated
// access, so it fails at the fetch step without any Gemini request.
const text =
  "## Coffee competitors near you\n\n1. **Fixture Roasters** sells single-origin beans online.\n2. **Bean Collective** runs weekend brewing workshops.\n\nThese businesses have not been independently verified.";
const end = (s: string) => text.indexOf(s) + s.length;
const answer = {
  provider: "gemini",
  display_only: true,
  text,
  sources: [
    { uri: "https://business.org/roasters", title: "Fixture roaster listing" },
    { uri: "https://www.iana.org/workshops", title: "Workshop directory" },
  ],
  citations: [
    { start: text.indexOf("**Fixture"), end: end("beans online."), source_indices: [0] },
    { start: text.indexOf("**Bean"), end: end("brewing workshops."), source_indices: [1] },
  ],
  search_suggestions_html: '<div><a target="_blank" href="https://www.google.com/search?q=coffee">coffee roasters</a></div>',
};

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

test("competitor intelligence workspace: discovery, watchlist, drawer, queue and insights", async ({ page }) => {
  const { companyId, id } = await signInWorkspace(page);
  await page.route("**/competitor-search", (route) => route.fulfill({ json: answer }));
  await page.goto("/dashboard/competitors");

  // Header, real company context and zero-state metrics.
  await expect(page.getByRole("heading", { name: "Know your competition. Stay ahead.", level: 1 })).toBeVisible();
  const summary = page.getByLabel("Competitor summary");
  for (const label of ["Saved competitors", "Researched competitors", "Approved competitors", "Research in progress"])
    await expect(summary.locator(".cx-metric", { hasText: label }).locator("strong")).toHaveText("0");
  await expect(page.getByRole("tab", { name: /Discover/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Your competitive landscape awaits.")).toBeVisible();
  await expect(page.getByText(/Search suggestions are for reference and are not automatically saved or researched/)).toBeVisible();

  // Empty states in the other tabs.
  await page.getByRole("tab", { name: /My Competitors/ }).click();
  await expect(page.getByText("Build your competitor watchlist.")).toBeVisible();
  await page.getByRole("tab", { name: /Research Queue/ }).click();
  await expect(page.getByText("You're all caught up.")).toBeVisible();
  await page.getByRole("tab", { name: /Approved Insights/ }).click();
  await expect(page.getByText("Turn competitors into insights.")).toBeVisible();

  // Grounded answer: structured Markdown, numbered citations, sources and suggestions.
  await page.getByRole("tab", { name: /Discover/ }).click();
  await page.getByRole("button", { name: "Discover competitors", exact: true }).click();
  const result = page.getByRole("article", { name: "Google grounded search results" });
  await expect(result.getByRole("heading", { name: "Coffee competitors near you" })).toBeVisible();
  await expect(result.locator(".gm-section")).toHaveCount(2);
  await expect(result.locator(".gm-section strong").first()).toHaveText("Fixture Roasters");
  await expect(result).not.toContainText("**");
  await expect(result).not.toContainText("##");
  await expect(result).toContainText("These businesses have not been independently verified.");
  await expect(result.getByRole("link", { name: "Source 1: Fixture roaster listing" })).toHaveText("1");
  await expect(result.getByRole("link", { name: "Source 2: Workshop directory" })).toHaveAttribute("href", "https://www.iana.org/workshops");
  await expect(result.getByRole("heading", { name: "Sources (2)" })).toBeVisible();
  await expect(result).toContainText("2 sources");
  await expect(page.frameLocator('iframe[title="Google Search Suggestions"]').getByRole("link", { name: "coffee roasters" })).toBeVisible();
  await expect(result.getByRole("button", { name: /import|approve|research|save/i })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Discover/ }).locator(".cx-count")).toHaveText("2");
  await page.screenshot({ path: "artifacts/competitor-discover-desktop.png", fullPage: true });

  // Bulk add independently sourced competitors (research off: no quota).
  await page.getByRole("button", { name: "Add competitor", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Bulk add" }).click();
  await dialog.getByLabel("Research automatically after saving (uses Gemini quota)").uncheck();
  await dialog.getByLabel("Competitors, one per line (Name, https://website)").fill("Fixture Roasters, https://www.iana.org\nRestricted Fixture, https://business.org");
  await dialog.getByRole("button", { name: "Save 2 competitors" }).click();
  await expect(dialog.getByText("created", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("tab", { name: /My Competitors/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("article", { name: "Restricted Fixture" }).getByRole("button", { name: "Research website" })).toBeVisible();

  const rows = await (await page.request.get(`${apiURL}/companies/${companyId}/competitors`)).json();
  const fixture = rows.find((r: { name: string }) => r.name === "Fixture Roasters");
  const backend = path.resolve(process.cwd(), "../backend");
  execFileSync(path.join(backend, ".venv/Scripts/python.exe"), ["scripts/seed_competitor_research_fixture.py", companyId, id, fixture.id], { cwd: backend, encoding: "utf8" });
  await page.reload();
  await page.getByRole("tab", { name: /My Competitors/ }).click();

  const card = page.getByRole("article", { name: "Fixture Roasters" });
  await expect(card.getByText("58/100")).toBeVisible();
  await expect(card.getByText("(heuristic)")).toBeVisible();
  await expect(card.getByLabel("Content themes")).toContainText("Origin stories");
  await expect(card.getByText("Researched", { exact: true })).toBeVisible();
  await expect(card.getByText("Verified", { exact: true })).toBeVisible();
  await expect(card.getByText("Pending review", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "View insights for Fixture Roasters" })).toBeVisible();
  await expect(summary.locator(".cx-metric", { hasText: "Saved competitors" }).locator("strong")).toHaveText("2");
  await expect(summary.locator(".cx-metric", { hasText: "Researched competitors" }).locator("strong")).toHaveText("1");

  // Search, filters, sort and views.
  await page.getByLabel("Research status").selectOption("not_researched");
  await expect(page.locator("article.cx-comp")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await page.getByLabel("Search competitors").fill("zzz-no-match");
  await expect(page.getByText("No matching competitors.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).last().click();
  await page.getByLabel("Sort competitors").selectOption("name");
  await expect(page.locator("article.cx-comp h3")).toHaveText(["Fixture Roasters", "Restricted Fixture"]);
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("table").getByRole("heading", { name: "Restricted Fixture" })).toBeVisible();
  await page.getByRole("button", { name: "Grid view" }).click();
  await page.screenshot({ path: "artifacts/competitor-intelligence-desktop.png", fullPage: true });

  // Details drawer with provenance labels and sticky actions.
  await card.getByRole("button", { name: "View insights for Fixture Roasters" }).click();
  const drawer = page.getByRole("dialog", { name: "Fixture Roasters" });
  for (const section of ["Overview", "Competitive relevance", "Key strengths", "Content strategy", "Supporting evidence (1)", "Research information"])
    await expect(drawer.getByRole("heading", { name: section })).toBeVisible();
  await expect(drawer.getByText("Show your roasting process step by step")).toBeVisible();
  await expect(drawer.getByText(/Based on the website: “Single-origin beans”/)).toBeVisible();
  await expect(drawer.getByText("AI interpretation").first()).toBeVisible();
  await expect(drawer.getByText("Strategic suggestion").first()).toBeVisible();
  await expect(drawer.getByText(/never estimated/)).toBeVisible();
  await page.screenshot({ path: "artifacts/competitor-drawer-desktop.png" });
  await drawer.getByRole("button", { name: "Approve competitor" }).click();
  await expect(drawer.getByText("Approved", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Close dialog" }).click();

  // Remove (confirmed, soft) and restore.
  await page.getByRole("button", { name: "Actions for Restricted Fixture" }).click();
  await page.getByRole("menuitem", { name: "Remove competitor" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove competitor" }).click();
  await expect(page.getByRole("article", { name: "Restricted Fixture" })).toHaveCount(0);
  await page.getByLabel("Approval status").selectOption("removed");
  await page.getByRole("button", { name: "Actions for Restricted Fixture" }).click();
  await page.getByRole("menuitem", { name: "Restore competitor" }).click();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByRole("article", { name: "Restricted Fixture" })).toBeVisible();

  // Real bulk research through the live worker; progress survives reload.
  await page.getByLabel("Select Restricted Fixture").check();
  await page.getByRole("button", { name: "Research selected (1)" }).click();
  await page.reload();
  await page.getByRole("tab", { name: /Research Queue/ }).click();
  const queueRow = page.locator(".cx-qrow", { hasText: "Restricted Fixture" }).first();
  await expect(queueRow).toBeVisible();
  await expect(queueRow.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 120000 });
  await expect(queueRow.getByText("Failed", { exact: true })).toBeVisible();

  // Approved insights.
  await page.getByRole("tab", { name: /Approved Insights/ }).click();
  await expect(page.getByText("1 approved competitor informs your AI content")).toBeVisible();
  await expect(page.getByRole("link", { name: /Create content with these insights/ })).toHaveAttribute("href", "/dashboard/content-studio");
  await expect(page.getByLabel("Common content themes")).toContainText("Brewing guides");
  await expect(page.getByLabel("Content opportunities")).toContainText("From research on Fixture Roasters");
  await expect(page.getByLabel("Supporting evidence")).toContainText("Single-origin beans");

  // Responsive layouts.
  for (const [width, name] of [[768, "tablet"], [375, "mobile"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: /My Competitors/ }).click();
    await expect(page.getByRole("article", { name: "Fixture Roasters" })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `artifacts/competitor-intelligence-${name}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "View insights for Fixture Roasters" }).click();
  const box = await page.getByRole("dialog", { name: "Fixture Roasters" }).boundingBox();
  expect(Math.round(box!.width)).toBe(375);
  await page.screenshot({ path: "artifacts/competitor-drawer-mobile.png" });
});

test("onboarding step uses the simplified competitor workspace and optional navigation", async ({ page }) => {
  await signInWorkspace(page);
  await page.route("**/competitor-search", (route) => route.fulfill({ json: answer }));
  await page.goto("/onboarding/competitors");
  await expect(page.getByRole("heading", { name: "Know your competition. Stay ahead.", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText([/Discover/, /My Competitors/]);
  await expect(page.getByLabel("Competitor summary")).toHaveCount(0);
  await page.getByRole("button", { name: "Discover competitors", exact: true }).click();
  await expect(page.getByRole("article", { name: "Google grounded search results" }).locator(".gm-section")).toHaveCount(2);
  for (const label of ["Back to brand identity", "Skip for now", "Continue to preferences"])
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  await page.screenshot({ path: "artifacts/competitor-onboarding-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: "artifacts/competitor-onboarding-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/onboarding\/preferences/);
});
