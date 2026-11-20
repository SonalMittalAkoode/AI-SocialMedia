import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { signInWorkspace, apiURL } from "./auth-helpers";
import { addDays, dayInZone } from "../../src/lib/scheduling-api";

const headers = { Origin: "http://localhost:3000" };
const backend = path.resolve(process.cwd(), "../backend");

function png() {
  const out = execFileSync(
    path.join(backend, ".venv/Scripts/python.exe"),
    [
      "-c",
      "import io,base64;from PIL import Image;b=io.BytesIO();Image.new('RGB',(300,300),'teal').save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())",
    ],
    { encoding: "utf8" },
  );
  return Buffer.from(out.trim(), "base64");
}

async function seed(page: Page, companyId: string) {
  const root = `${apiURL}/companies/${companyId}`;
  const make = async (title: string, platform: string, hashtags: string[]) => {
    const r = await page.request.post(`${root}/posts`, {
      headers,
      data: {
        creation_key: randomUUID(),
        title,
        platform,
        content_type: "text",
        caption: `${title} caption for the dashboard.`,
        hashtags,
        hook: "",
        call_to_action: "",
        image_prompt: "",
        slides: [],
      },
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const withImage = await make("Pictured roast", "Instagram", [
    "#Roast",
    "#Fresh",
  ]);
  await make("Plain update", "LinkedIn", ["#Update"]);
  const approved = await make("Approved note", "X", []);
  const upload = await page.request.post(
    `${root}/posts/${withImage.id}/assets/upload?revision=${withImage.revision}&filename=roast.png`,
    {
      headers: { ...headers, "Content-Type": "image/png" },
      data: png(),
    },
  );
  expect(upload.status()).toBe(201);
  expect(
    (
      await page.request.post(`${root}/posts/${approved.id}/approve`, {
        headers,
        data: { revision: approved.revision },
      })
    ).status(),
  ).toBe(200);
  return { approved, withImage };
}

test("CRM navigation, real overview metrics, library filters and quick actions", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseURL,
  });
  const { companyId } = await signInWorkspace(page);
  await seed(page, companyId);
  await page.goto("/dashboard");

  const nav = page
    .getByRole("navigation")
    .filter({ has: page.getByRole("link", { name: "Post Library" }) })
    .first();
  await expect(
    nav.getByRole("link", { name: "Competitor Intelligence" }),
  ).toBeVisible();
  const labels = await nav.getByRole("link").allInnerTexts();
  const names = labels.map((l) => l.split(/\r?\n/)[0].trim()).filter(Boolean);
  expect(names).toEqual(
    expect.arrayContaining([
      "Overview",
      "Companies & Brands",
      "AI Content Studio",
      "Post Library",
      "Competitor Intelligence",
      "Content Calendar",
      "Social Accounts",
      "Analytics",
    ]),
  );
  const order = names;
  expect(order.indexOf("Social Accounts")).toBeLessThan(
    order.indexOf("Analytics"),
  );

  // Metrics equal what this test created.
  await expect(page.locator(".creative-metric")).toHaveCount(4);
  for (const label of ["Total Posts: 3", "Scheduled: 0", "AI Creations: 0"])
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Needs Attention: 2", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Total Posts: 3", exact: true }).click();
  await expect(page.getByLabel("Filter by image")).toBeVisible();
  await page.getByLabel("Filter by image").selectOption("with_image");
  await expect(page.getByText("1 saved post", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Saved post asset" }),
  ).toBeVisible();
  const download = page.getByRole("link", {
    name: "Download image of Pictured roast",
  });
  expect(await download.getAttribute("href")).toContain("download=true");
  await expect(page.getByText("#Roast #Fresh")).toBeVisible();

  // Date filter (company timezone) and clearing filters.
  await page.getByLabel("Filter by image").selectOption("");
  await page.getByLabel("Created from").fill("2099-01-01");
  await expect(page.getByText("No saved posts found")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByText("3 saved posts", { exact: false })).toBeVisible();

  // Quick actions reuse revision-checked APIs.
  await page
    .getByRole("button", { name: "Copy caption of Plain update" })
    .click();
  await expect(page.getByText("Caption copied: Plain update")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Plain update caption",
  );
  await page.getByRole("button", { name: "Approve Plain update" }).click();
  await expect(page.getByText("Approved: Plain update")).toBeVisible();
  await page.getByRole("button", { name: "Duplicate Pictured roast" }).click();
  await expect(
    page.getByText("Duplicated as a new draft: Pictured roast"),
  ).toBeVisible();
  await expect(page.getByText("4 saved posts", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Archive Approved note" }).click();
  await expect(
    page.getByText("Archived (retained): Approved note"),
  ).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("archived");
  await expect(page.getByText("1 saved post", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Restore Approved note" }).click();
  await expect(
    page.getByText("Restored to draft: Approved note"),
  ).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("");
  // The duplicate carries its own copy of the image.
  await page.getByLabel("Filter by image").selectOption("with_image");
  await expect(page.getByText("2 saved posts", { exact: false })).toBeVisible();
  await page.getByLabel("Filter by image").selectOption("");
  await expect(page.getByText("4 saved posts", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy caption of Plain update" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/crm-library-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Card view" }).click();
  await expect(
    page.getByRole("button", { name: "Copy caption of Plain update" }),
  ).toBeVisible();

  // Overview reflects the actions.
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Total Posts: 4", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Needs Attention: 3", exact: true }),
  ).toBeVisible();

  // Collapsible sidebar is remembered.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  for (const [width, name] of [
    [768, "tablet"],
    [375, "mobile"],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dashboard");
    await expect(
      page.getByRole("link", { name: "Total Posts: 4", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `artifacts/crm-overview-${name}.png`,
      fullPage: true,
    });
    await page.goto("/dashboard/posts");
    await expect(
      page.getByText("4 saved posts", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `artifacts/crm-library-${name}.png`,
      fullPage: false,
    });
  }
});

const screenshots = "artifacts/dashboard-redesign";
const screenshotStyle = "nextjs-portal { display: none !important; }";
async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    fullPage: true,
    animations: "disabled",
    style: screenshotStyle,
  });
}
async function captureSection(section: Locator, name: string) {
  await section.screenshot({ path: `${screenshots}/${name}.png`, animations: "disabled", style: screenshotStyle });
}

test("creative Overview uses saved posts and company-local schedules with a reviewable AI brief", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { companyId } = await signInWorkspace(page);
  const { approved, withImage } = await seed(page, companyId);
  const root = `${apiURL}/companies/${companyId}`;
  const zone = "America/New_York";
  const company = await (await page.request.get(root)).json();
  const updated = await page.request.patch(root + "/scheduling-preferences", {
    headers,
    data: { revision: company.revision, timezone: zone },
  });
  expect(updated.ok()).toBeTruthy();
  const approvedPost = await (
    await page.request.get(root + "/posts/" + approved.id)
  ).json();
  const plan = await page.request.post(root + "/schedules", {
    headers,
    data: {
      post_id: approved.id,
      post_revision: approvedPost.revision,
      target_platform: "X",
      local_date: addDays(dayInZone(new Date(), zone), 3),
      local_time: "09:15",
      timezone: zone,
      idempotency_key: randomUUID(),
    },
  });
  expect(plan.status()).toBe(201);
  const schedule = await plan.json();

  let generations = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/content-generations")
    )
      generations += 1;
  });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Your creative workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create Post", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".header-breadcrumb")).toContainText(company.name);
  await expect(
    page.getByRole("button", { name: "Switch active workspace or company" }),
  ).toHaveText(company.name);
  const recent = page.getByRole("region", {
    name: "Recent Posts",
    exact: true,
  });
  const upcoming = page.getByRole("region", {
    name: "Upcoming Schedule",
    exact: true,
  });
  const hero = page.getByRole("region", {
    name: "What should we create today?",
  });
  const pictured = recent.getByRole("link", { name: /Pictured roast/ });
  await expect(pictured).toHaveAttribute(
    "href",
    `/dashboard/posts?edit=${withImage.id}`,
  );
  await expect
    .poll(() =>
      pictured
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    recent.getByRole("link", { name: /Approved note/ }),
  ).toContainText("Scheduled");
  await expect(
    page.getByRole("link", { name: "Scheduled: 1", exact: true }),
  ).toBeVisible();
  await expect(
    upcoming.getByRole("link", { name: /Approved note/ }),
  ).toHaveAttribute("href", `/dashboard/calendar?schedule=${schedule.id}`);
  await expect(upcoming.getByText("09:15", { exact: true })).toBeVisible();
  await expect(upcoming.getByText("Times in America/New_York")).toBeVisible();
  const checklist = page.getByRole("region", { name: "Setup checklist" });
  await expect(
    checklist.getByRole("heading", { name: "Get the most out of SocialAI" }),
  ).toBeVisible();
  await expect(
    checklist.getByRole("button", { name: "Checklist", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");

  for (const width of [1920, 1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${width}px`,
    ).toBe(true);
    const metrics = page.getByRole("region", { name: "Company metrics" });
    expect(
      await metrics.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(width > 1024 ? 4 : 2);
    if (width === 1440) {
      await capture(page, "populated-desktop");
      await captureSection(hero, "creation-hero");
      await captureSection(page.locator(".creative-columns"), "recent-and-schedule");
      await checklist
        .getByRole("button", { name: "Checklist", exact: true })
        .click();
      await expect(
        checklist.getByRole("link", { name: /Discover competitors/ }),
      ).toBeVisible();
      await captureSection(checklist, "checklist");
      await checklist
        .getByRole("button", { name: "Checklist", exact: true })
        .click();
    }
    if (width === 375) {
      await capture(page, "populated-mobile");
      await captureSection(hero, "creation-hero-mobile");
      await captureSection(page.locator(".creative-columns"), "recent-and-schedule-mobile");
      const toggle = checklist.getByRole("button", { name: "Checklist", exact: true });
      await toggle.click();
      await captureSection(checklist, "checklist-mobile");
      await toggle.click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await pictured.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goto("/dashboard");
  await page
    .getByRole("region", { name: "Upcoming Schedule", exact: true })
    .getByRole("link", { name: /Approved note/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`schedule=${schedule.id}`));
  await page.goto("/dashboard");
  const idea = "Introduce our new weekend blend & brewing workshop.";
  await page.getByRole("textbox", { name: "Post idea" }).fill(idea);
  await page.getByRole("button", { name: "Create with AI" }).click();
  await expect(page.getByLabel("What's the story?")).toHaveValue(idea);
  await expect(page.locator(".header-breadcrumb")).toContainText(company.name);
  await page.reload();
  await expect(page.getByLabel("What's the story?")).toHaveValue(idea);
  expect(generations).toBe(0);
});

test("empty Overview and checklist stay scoped when company switching is delayed", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { companyId, workspaceId } = await signInWorkspace(page);
  const second = await page.request.post(
    `${apiURL}/workspaces/${workspaceId}/companies`,
    {
      headers,
      data: {
        name: "Harbour Creative",
        description: "A separate company for dashboard isolation.",
      },
    },
  );
  expect(second.status()).toBe(201);
  const secondCompany = await second.json();
  await seed(page, companyId);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Total Posts: 3" }),
  ).toBeVisible();
  let release = () => {};
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route(`**/companies/${secondCompany.id}/brand`, async (route) => {
    await pending;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Switch active workspace or company" })
    .click();
  await page.getByLabel("Active company").selectOption(secondCompany.id);
  try {
    await expect(
      page.getByRole("status").filter({ hasText: "Loading selected company" }),
    ).toBeVisible();
    await expect(page.getByText("Pictured roast", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    release();
  }
  await expect(page.locator(".header-breadcrumb")).toContainText(
    "Harbour Creative",
  );
  await expect(
    page.getByRole("button", { name: "Switch active workspace or company" }),
  ).toHaveText("Harbour Creative");
  await expect(
    page.getByRole("link", { name: "Total Posts: 0" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No posts yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nothing scheduled yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue company setup" }),
  ).toBeVisible();
  await expect(page.getByText("Pictured roast", { exact: true })).toHaveCount(
    0,
  );
  await capture(page, "after-switch-desktop");
  await page.setViewportSize({ width: 390, height: 900 });
  await capture(page, "empty-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture(page, "empty-desktop");
  await page.getByRole("button", { name: "Create with AI" }).click();
  await expect(page.getByLabel("What's the story?")).toHaveValue("");
  await page.goto(`/dashboard/content-studio?new=1&company=${companyId}&topic=Prior-company+brief`);
  await expect(page.getByLabel("What's the story?")).toHaveValue("");
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Switch active workspace or company" })
    .click();
  await page.getByLabel("Active company").selectOption(companyId);
  const checklist = page.getByRole("region", { name: "Setup checklist" });
  await expect(checklist).toBeVisible();
  await checklist
    .getByRole("button", { name: "Dismiss setup checklist" })
    .click();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Total Posts: 3" }),
  ).toBeVisible();
  await expect(checklist).toHaveCount(0);
});
