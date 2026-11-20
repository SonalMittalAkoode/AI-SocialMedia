import { expect, test } from "@playwright/test";
import { apiURL, signInWorkspace } from "./auth-helpers";

const text =
  "Grounded Candidate offers software services. Identity has not been independently verified.";
const answer = {
  provider: "gemini",
  display_only: true,
  text,
  sources: [{ uri: "https://business.org", title: "Grounded source fixture" }],
  citations: [{ start: 0, end: 43, source_indices: [0] }],
  search_suggestions_html:
    '<style>.search{padding:16px}</style><div class="search"><a target="_blank" href="https://www.google.com/search?q=software">Google Search fixture suggestion</a></div>',
};

test("Gemini discovery displays citations and Search Suggestions without saving or importing", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  let requests = 0;
  await page.route("**/competitor-search", async (route) => {
    requests++;
    await route.fulfill({ json: answer });
  });
  await page.goto("/dashboard/competitors");
  await expect(
    page.getByRole("button", { name: "Discover competitors", exact: true }),
  ).toBeEnabled();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Discover competitors", exact: true })
    .click();
  const result = page.getByRole("article", {
    name: "Google grounded search results",
  });
  await expect(result).toContainText(
    "Grounded Candidate offers software services",
  );
  await expect(result).toContainText(
    "Identity has not been independently verified.",
  );
  await expect(
    result.getByRole("link", { name: "Source 1: Grounded source fixture" }),
  ).toHaveAttribute("href", "https://business.org");
  const frame = page.frameLocator('iframe[title="Google Search Suggestions"]');
  await expect(
    frame.getByRole("link", { name: "Google Search fixture suggestion" }),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="Google Search Suggestions"]'),
  ).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  await page.screenshot({
    path: "artifacts/grounded-competitors-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 1000 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "artifacts/grounded-competitors-mobile.png",
    fullPage: true,
  });
  await expect(
    result.getByRole("button", { name: /import|approve|research|save/i }),
  ).toHaveCount(0);
  expect(
    await (
      await page.request.get(`${apiURL}/companies/${companyId}/competitors`)
    ).json(),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(text);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Discover competitors", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("article", { name: "Google grounded search results" }),
  ).toHaveCount(0);
  expect(requests).toBe(1);
});

test("quota failure keeps independently sourced manual competitors available", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  await page.route("**/competitor-search", (route) =>
    route.fulfill({
      status: 429,
      json: {
        detail:
          "search_rate_limited: Try later or use independent manual research.",
      },
    }),
  );
  await page.goto("/dashboard/competitors");
  await page
    .getByRole("button", { name: "Discover competitors", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "search_rate_limited" }),
  ).toBeVisible();
  // The failed-discovery state offers its own "Add competitor" fallback (the header has one too).
  await page
    .getByRole("button", { name: "Add competitor", exact: true })
    .last()
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "obtained independently",
  );
  await page.getByLabel("Company name").fill("Independent record");
  await page.getByLabel("Competitor website").fill("https://business.org");
  await page
    .getByRole("button", { name: "Save competitor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Independent record" }),
  ).toBeVisible();
  const rows = await (
    await page.request.get(`${apiURL}/companies/${companyId}/competitors`)
  ).json();
  expect(rows).toHaveLength(1);
  expect(rows[0].source_provider).toBe("manual");
});

test("explicit CRM discovery stays scoped to the selected company", async ({
  page,
}) => {
  const { workspaceId } = await signInWorkspace(page);
  const created = await page.request.post(
    `${apiURL}/workspaces/${workspaceId}/companies`,
    {
      headers: { Origin: "http://localhost:3000" },
      data: { name: "Separate search company" },
    },
  );
  expect(created.status()).toBe(201);
  const secondCompany = await created.json();
  await page.route("**/competitor-search", (route) =>
    route.fulfill({ json: answer }),
  );
  await page.goto("/dashboard/competitors");
  await page
    .getByRole("button", { name: "Discover competitors", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Google grounded search results" }),
  ).toBeVisible();
  await page.locator(".sidebar .workspace-button").click();
  await page.getByLabel("Active company").selectOption(secondCompany.id);
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/dashboard/competitors");
  await expect(
    page.getByRole("article", { name: "Google grounded search results" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Grounded Candidate" }),
  ).toHaveCount(0);
});

test("OpenAI web search shows clickable citations without Google suggestions, saving or importing", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  const openaiText = "Harbour Roasters sells single-origin coffee in Leeds. Its identity has not been verified.";
  await page.route("**/competitor-search", (route) =>
    route.fulfill({
      json: {
        provider: "openai",
        display_only: true,
        text: openaiText,
        sources: [{ uri: "https://www.harbourroasters.co.uk/", title: "Harbour Roasters" }],
        citations: [{ start: 0, end: 52, source_indices: [0] }],
        search_suggestions_html: "",
      },
    }),
  );
  await page.goto("/dashboard/competitors");
  await page.getByRole("button", { name: "Discover competitors", exact: true }).click();
  const result = page.getByRole("article", { name: "OpenAI web search results" });
  await expect(result).toContainText("Searched with OpenAI web search");
  await expect(result).toContainText("Harbour Roasters sells single-origin coffee in Leeds");
  await expect(result.getByRole("link", { name: "Source 1: Harbour Roasters" })).toHaveAttribute(
    "href",
    "https://www.harbourroasters.co.uk/",
  );
  await expect(page.locator('iframe[title="Google Search Suggestions"]')).toHaveCount(0);
  await expect(result.getByRole("button", { name: /import|approve|research|save/i })).toHaveCount(0);
  expect(await (await page.request.get(`${apiURL}/companies/${companyId}/competitors`)).json()).toEqual([]);
  await page.screenshot({ path: "artifacts/openai-competitor-search-desktop.png", fullPage: true });
});
