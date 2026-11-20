import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { mkdirSync } from "node:fs";
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
const screenshotRoot = "artifacts/phase-7.7";
const viewports = [[1920], [1440, "desktop"], [1024], [768, "tablet"], [390, "mobile"], [375]] as const;
async function capture(page: Page, view: string, fullPage = true) {
  mkdirSync(screenshotRoot, { recursive: true });
  for (const [width, label] of viewports) {
    await page.setViewportSize({ width, height: width >= 1000 ? 1000 : 900 });
    expect(await noOverflow(page)).toBe(true);
    if (label) await page.screenshot({ path: `${screenshotRoot}/${view}-${label}.png`, fullPage });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("competitor intelligence workspace: discovery, watchlist, drawer, queue and insights", async ({ page }) => {
  test.setTimeout(90_000);
  const { companyId, id } = await signInWorkspace(page);
  await page.route("**/competitor-search", (route) => route.fulfill({ json: answer }));
  await page.goto("/dashboard/competitors");

  // Header, real company context and zero-state metrics.
  await expect(page.getByRole("heading", { name: "Competitor Intelligence", level: 1 })).toBeVisible();
  const summary = page.getByLabel("Competitor summary");
  for (const label of ["Saved competitors", "Researched competitors", "Approved competitors", "Research in progress"])
    await expect(summary.locator(".cx-metric", { hasText: label }).locator("strong")).toHaveText("0");
  await expect(page.getByRole("tab", { name: /Discover/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Your competitive landscape awaits.")).toBeVisible();
  await expect(page.getByText("Discovery suggestions are for reference only. Independently sourced competitors can be added and researched separately.")).toBeVisible();

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
  await capture(page, "discover");

  // Bulk add independently sourced competitors (research off: no quota).
  await page.getByRole("button", { name: "Add competitor", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Bulk add" }).click();
  await dialog.getByLabel("Research automatically after saving (uses AI quota)").uncheck();
  await dialog.getByLabel("Competitors, one per line (Name, https://website)").fill("Fixture Roasters, https://www.iana.org\nRestricted Fixture, https://research-fixture-7b38f53b8b9d.iana.org");
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
  await capture(page, "my-competitors");

  // Details drawer with provenance labels and sticky actions.
  await card.getByRole("button", { name: "View insights for Fixture Roasters" }).click();
  const drawer = page.getByRole("dialog", { name: "Fixture Roasters" });
  for (const section of ["Company Overview", "Competitive Relevance", "Competitive Strengths", "Content Intelligence", "Supporting evidence (1)", "Research History"])
    await expect(drawer.getByRole("heading", { name: section })).toBeVisible();
  await expect(drawer.getByText("Show your roasting process step by step")).toBeVisible();
  await expect(drawer.getByText(/Based on the website: “Single-origin beans”/)).toBeVisible();
  await expect(drawer.getByText("AI interpretation").first()).toBeVisible();
  await expect(drawer.getByText("Strategic suggestion").first()).toBeVisible();
  await expect(drawer.getByText(/never estimated/)).toBeVisible();
  await capture(page, "details-drawer", false);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(card.getByRole("button", { name: "View insights for Fixture Roasters" })).toBeFocused();
  await card.getByRole("button", { name: "View insights for Fixture Roasters" }).click();
  await drawer.getByRole("button", { name: "Approve competitor" }).click();
  await expect(drawer.getByText("Approved", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Close dialog" }).click();

  // Remove (confirmed, soft) and restore.
  await page.getByRole("button", { name: "Actions for Restricted Fixture" }).click();
  await page.getByRole("menuitem", { name: "Remove competitor" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove competitor" }).click();
  await expect(page.getByRole("article", { name: "Restricted Fixture" })).toHaveCount(0);
  await page.getByLabel("Record status").selectOption("removed");
  await page.getByRole("button", { name: "Actions for Restricted Fixture" }).click();
  await page.getByRole("menuitem", { name: "Restore competitor" }).click();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByRole("article", { name: "Restricted Fixture" })).toBeVisible();

  // Real bulk research through the live worker; progress survives reload.
  const second = await page.request.post(`${apiURL}/companies/${companyId}/competitors`, {
    headers: { Origin: "http://localhost:3000" },
    data: { name: "Second DNS Fixture", website_url: "https://research-fixture-2-f17010437009.iana.org" },
  });
  expect(second.status()).toBe(201);
  await page.reload();
  await page.getByLabel("Select Restricted Fixture").check();
  await page.getByLabel("Select Second DNS Fixture").check();
  const admitted = page.waitForResponse((response) => response.url().endsWith("/competitors/research-batch") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Research selected (2)" }).click();
  expect((await admitted).status()).toBe(202);
  await page.reload();
  await page.getByRole("tab", { name: /Research Queue/ }).click();
  const queueRow = page.locator(".cx-qrow", { hasText: "Restricted Fixture" }).first();
  await expect(queueRow).toBeVisible();
  await expect(queueRow.getByRole("button", { name: "Retry research" })).toBeVisible({ timeout: 120000 });
  await expect(queueRow.getByText("Failed", { exact: true })).toBeVisible();
  await expect(queueRow.getByText(/Finished /)).toBeVisible();
  await expect(page.getByLabel("Bulk research progress")).toContainText("2 of 2 finished");
  await capture(page, "research-queue");
  await page.setViewportSize({ width: 768, height: 900 });
  expect((await queueRow.locator(".cx-qmain").boundingBox())!.width).toBeGreaterThan(140);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Approved insights.
  await page.getByRole("tab", { name: /Approved Insights/ }).click();
  await expect(page.getByText("1 approved competitor informs your AI content")).toBeVisible();
  await expect(page.getByRole("link", { name: /Create content with these insights/ })).toHaveAttribute("href", "/dashboard/content-studio");
  await expect(page.getByLabel("Common content themes")).toContainText("Brewing guides");
  await expect(page.getByLabel("Content opportunities")).toContainText("From research on Fixture Roasters");
  await expect(page.getByLabel("Supporting evidence")).toContainText("Single-origin beans");
  await capture(page, "approved-insights");
  let generationRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/content-generations")) generationRequests++;
  });
  await page.getByRole("link", { name: /Create content with these insights/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/content-studio$/);
  // Phase 8A.1 renamed the Studio panel heading to "Creative brief".
  await expect(page.getByRole("heading", { name: "Creative brief" })).toBeVisible();
  expect(generationRequests).toBe(0);
  await page.goBack();

  // Responsive layouts.
  for (const width of [1920, 1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: /My Competitors/ }).click();
    await expect(page.getByRole("article", { name: "Fixture Roasters" })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.getByRole("button", { name: "Table view" }).click();
    expect(await noOverflow(page)).toBe(true);
    await page.getByRole("button", { name: "Grid view" }).click();
  }
  await page.getByRole("button", { name: "View insights for Fixture Roasters" }).click();
  const box = await page.getByRole("dialog", { name: "Fixture Roasters" }).boundingBox();
  expect(Math.round(box!.width)).toBe(375);
});

test("watchlist filters and paginates records beyond the first API page", async ({ page }) => {
  const { companyId } = await signInWorkspace(page);
  const rows = Array.from({ length: 103 }, (_, i) => ({
    id: `31bbd68b-628c-44a6-8681-${String(i).padStart(12, "0")}`,
    company_id: companyId,
    name: `Pagination fixture ${String(i).padStart(3, "0")}`,
    website_url: "https://example.org/",
    industry: "Test industry",
    description: null,
    selection_status: "suggested",
    verification_status: i === 100 ? "unverified" : "verified",
    relevance_score: i % 100,
    relevance_reason: "Test score",
    source_provider: "manual",
    source_url: "https://example.org/",
    revision: 1,
    last_researched_at: "2026-01-01T00:00:00Z",
    city: "Test city",
    country: "Test country",
    removed_at: i === 102 ? "2026-01-02T00:00:00Z" : null,
  }));
  await page.route(`**/companies/${companyId}/competitors?*`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("offset") || 0);
    return route.fulfill({ json: rows.slice(offset, offset + Number(params.get("limit"))) });
  });
  await page.goto("/dashboard/competitors");
  await page.getByRole("tab", { name: /My Competitors/ }).click();
  await expect(page.getByRole("navigation", { name: "Competitor pages" })).toContainText("1–12 of 102");
  await page.getByLabel("Sort competitors").selectOption("lowest");
  await expect(page.locator("article.cx-comp h3").first()).toHaveText("Pagination fixture 000");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Competitor pages" })).toContainText("13–24 of 102");
  await page.getByLabel("Search competitors").fill("101");
  await expect(page.getByRole("article", { name: "Pagination fixture 101" })).toBeVisible();
  await page.getByLabel("Relevance range").selectOption("70-100");
  await expect(page.getByText("No matching competitors.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await page.getByLabel("Search competitors").fill("100");
  await expect(page.getByRole("article", { name: "Pagination fixture 100" }).locator(".cx-relevance")).toContainText("Not researched");
  await page.getByLabel("Search competitors").clear();
  await page.getByLabel("Record status").selectOption("removed");
  await expect(page.getByRole("article", { name: "Pagination fixture 102" })).toBeVisible();
});

test("legacy competitor onboarding links return to the completed workspace", async ({ page }) => {
  await signInWorkspace(page);
  await page.goto("/onboarding/competitors");
  await expect(page).toHaveURL("/dashboard");
  const checklist = page.getByRole("region", { name: "Setup checklist" });
  await checklist.getByRole("button", { name: "Checklist", exact: true }).click();
  await checklist.getByRole("link", { name: /Discover competitors/ }).click();
  await expect(page).toHaveURL("/dashboard/competitors");
  await expect(page.getByRole("button", { name: "Discover competitors", exact: true })).toBeVisible();
});
