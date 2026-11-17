import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";

const headers = { Origin: "http://localhost:3000" };
const backend = path.resolve(process.cwd(), "../backend");

function png() {
  const out = execFileSync(
    path.join(backend, ".venv/Scripts/python.exe"),
    ["-c", "import io,base64;from PIL import Image;b=io.BytesIO();Image.new('RGB',(300,300),'teal').save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())"],
    { encoding: "utf8" },
  );
  return Buffer.from(out.trim(), "base64");
}

async function seed(page: Page, companyId: string) {
  const root = `${apiURL}/companies/${companyId}`;
  const make = async (title: string, platform: string, hashtags: string[]) => {
    const r = await page.request.post(`${root}/posts`, {
      headers,
      data: { creation_key: randomUUID(), title, platform, content_type: "text", caption: `${title} caption for the dashboard.`, hashtags, hook: "", call_to_action: "", image_prompt: "", slides: [] },
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const withImage = await make("Pictured roast", "Instagram", ["#Roast", "#Fresh"]);
  await make("Plain update", "LinkedIn", ["#Update"]);
  const approved = await make("Approved note", "X", []);
  const upload = await page.request.post(`${root}/posts/${withImage.id}/assets/upload?revision=${withImage.revision}&filename=roast.png`, {
    headers: { ...headers, "Content-Type": "image/png" },
    data: png(),
  });
  expect(upload.status()).toBe(201);
  expect((await page.request.post(`${root}/posts/${approved.id}/approve`, { headers, data: { revision: approved.revision } })).status()).toBe(200);
}

test("CRM navigation, real overview metrics, library filters and quick actions", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
  const { companyId } = await signInWorkspace(page);
  await seed(page, companyId);
  await page.goto("/dashboard");

  const nav = page
    .getByRole("navigation")
    .filter({ has: page.getByRole("link", { name: "Post Library" }) })
    .first();
  await expect(nav.getByRole("link", { name: "Competitor Intelligence" })).toBeVisible();
  const labels = await nav.getByRole("link").allInnerTexts();
  const names = labels.map((l) => l.split(/\r?\n/)[0].trim()).filter(Boolean);
  expect(names).toEqual(
    expect.arrayContaining(["Overview", "Companies & Brands", "AI Content Studio", "Post Library", "Competitor Intelligence", "Content Calendar", "Social Accounts", "Analytics"]),
  );
  const order = names;
  expect(order.indexOf("Social Accounts")).toBeLessThan(order.indexOf("Analytics"));

  // Metrics equal what this test created.
  for (const label of ["Generated posts: 0", "Total saved posts: 3", "Draft posts: 2", "Approved posts: 1", "Scheduled posts: 0", "Awaiting publisher: 0", "Blocked schedules: 0", "Posts with images: 1"])
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  const generation = page.getByLabel("Content generation statistics");
  await expect(generation.locator("div", { hasText: "Images uploaded" }).locator("dd")).toHaveText("1");
  await expect(generation.locator("div", { hasText: "Written manually" }).locator("dd")).toHaveText("3");
  await expect(page.getByLabel("Competitor statistics").locator("div", { hasText: "Tracked competitors" }).locator("dd")).toHaveText("0");
  await expect(page.getByText(/No reach, engagement or publishing results are inferred/)).toBeVisible();
  await page.screenshot({ path: "artifacts/crm-overview-desktop.png", fullPage: true });

  // KPI drills into the matching library filter.
  await page.getByRole("link", { name: "Posts with images: 1", exact: true }).click();
  await expect(page).toHaveURL(/media=with_image/);
  await expect(page.getByLabel("Filter by image")).toHaveValue("with_image");
  await expect(page.getByText("1 saved post", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: "Saved post asset" })).toBeVisible();
  const download = page.getByRole("link", { name: "Download image of Pictured roast" });
  expect(await download.getAttribute("href")).toContain("download=true");
  await expect(page.getByText("#Roast #Fresh")).toBeVisible();

  // Date filter (company timezone) and clearing filters.
  await page.getByLabel("Filter by image").selectOption("");
  await page.getByLabel("Created from").fill("2099-01-01");
  await expect(page.getByText("No saved posts found")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByText("3 saved posts", { exact: false })).toBeVisible();

  // Quick actions reuse revision-checked APIs.
  await page.getByRole("button", { name: "Copy caption of Plain update" }).click();
  await expect(page.getByText("Caption copied: Plain update")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Plain update caption");
  await page.getByRole("button", { name: "Approve Plain update" }).click();
  await expect(page.getByText("Approved: Plain update")).toBeVisible();
  await page.getByRole("button", { name: "Duplicate Pictured roast" }).click();
  await expect(page.getByText("Duplicated as a new draft: Pictured roast")).toBeVisible();
  await expect(page.getByText("4 saved posts", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Archive Approved note" }).click();
  await expect(page.getByText("Archived (retained): Approved note")).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("archived");
  await expect(page.getByText("1 saved post", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Restore Approved note" }).click();
  await expect(page.getByText("Restored to draft: Approved note")).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("");
  // The duplicate carries its own copy of the image.
  await page.getByLabel("Filter by image").selectOption("with_image");
  await expect(page.getByText("2 saved posts", { exact: false })).toBeVisible();
  await page.getByLabel("Filter by image").selectOption("");
  await expect(page.getByText("4 saved posts", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy caption of Plain update" })).toBeVisible();
  await page.screenshot({ path: "artifacts/crm-library-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Card view" }).click();
  await expect(page.getByRole("button", { name: "Copy caption of Plain update" })).toBeVisible();

  // Overview reflects the actions.
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Total saved posts: 4", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Approved posts: 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Posts with images: 2", exact: true })).toBeVisible();

  // Collapsible sidebar is remembered.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  for (const [width, name] of [[768, "tablet"], [375, "mobile"]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Total saved posts: 4", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `artifacts/crm-overview-${name}.png`, fullPage: true });
    await page.goto("/dashboard/posts");
    await expect(page.getByText("4 saved posts", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `artifacts/crm-library-${name}.png`, fullPage: false });
  }
});
