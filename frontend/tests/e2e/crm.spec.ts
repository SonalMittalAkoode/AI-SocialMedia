import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { signInWorkspace, apiURL, testPassword } from "./auth-helpers";
import { editable } from "../../src/lib/content-api";
import { addDays, dayInZone } from "../../src/lib/scheduling-api";
const headers = { Origin: "http://localhost:3000" };

test("manual library drafts persist across company switching and a new login", async ({
  page,
}) => {
  const { companyId, workspaceId, email } = await signInWorkspace(page);
  const second = await (
    await page.request.post(`${apiURL}/workspaces/${workspaceId}/companies`, {
      headers,
      data: {
        name: "Another library company",
        description: "An isolated second company for manual content.",
      },
    })
  ).json();
  await page.goto("/dashboard/posts");
  await expect(
    page.getByText("No saved posts found", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Post title", { exact: true })
    .fill("Manual CRM note");
  await page
    .getByRole("dialog")
    .getByLabel("Caption", { exact: true })
    .fill("A saved manual draft without an AI generation.");
  await page
    .getByRole("button", { name: "Save new draft", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review saved draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Edit Manual CRM note", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Library company").selectOption(second.id);
  await expect(page).toHaveURL("/dashboard/posts");
  await expect(
    page.getByRole("button", { name: "Edit Manual CRM note", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await page.request.get(`${apiURL}/companies/${second.id}/post-library`)
      ).json()
    ).total,
  ).toBe(0);
  await page.locator(".sidebar .workspace-button").click();
  await page.getByLabel("Active company").selectOption(companyId);
  await expect(page).toHaveURL("/dashboard");
  await page
    .getByRole("button", { name: "Open profile menu", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log out", exact: true })
    .click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page
    .getByRole("button", { name: "Log in to your workspace", exact: true })
    .click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/dashboard/posts");
  await expect(
    page.getByRole("button", { name: "Edit Manual CRM note", exact: true }),
  ).toBeVisible();
});

test("CRM metrics and library support real search, pagination, revisions and schedule linkage", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { companyId } = await signInWorkspace(page);
  const root = `${apiURL}/companies/${companyId}`;
  const posts = [];
  for (let i = 1; i <= 26; i++) {
    const r = await page.request.post(root + "/posts", {
      headers,
      data: {
        creation_key: randomUUID(),
        title: `CRM record ${String(i).padStart(3, "0")}`,
        caption: `Retained company caption ${i}`,
        platform: "LinkedIn",
        content_type: "text",
        hashtags: [],
      },
    });
    expect(r.status()).toBe(201);
    posts.push(await r.json());
  }
  posts[0] = await (
    await page.request.post(root + `/posts/${posts[0].id}/approve`, {
      headers,
      data: { revision: 1 },
    })
  ).json();
  await page.request.patch(root + `/posts/${posts[1].id}`, {
    headers,
    data: { ...editable(posts[1]), revision: 1, status: "ready_for_review" },
  });
  await page.request.patch(root + `/posts/${posts[2].id}`, {
    headers,
    data: { ...editable(posts[2]), revision: 1, status: "archived" },
  });
  const schedule = await page.request.post(root + "/schedules", {
    headers,
    data: {
      post_id: posts[0].id,
      post_revision: posts[0].revision,
      target_platform: "LinkedIn",
      local_date: addDays(dayInZone(new Date(), "Asia/Kolkata"), 3),
      local_time: "10:00",
      timezone: "Asia/Kolkata",
      idempotency_key: randomUUID(),
    },
  });
  expect(schedule.status()).toBe(201);
  await page.goto("/dashboard");
  for (const name of [
    "Total Posts: 26",
    "Scheduled: 1",
    "AI Creations: 0",
  ])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Needs Attention: 24" })).toBeVisible();
  await expect(
    page.getByText("Creative momentum", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/crm-overview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/crm-overview-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard/posts");
  await expect(
    page.getByRole("heading", { name: "Post Library", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1–25 of 26", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("26–26 of 26", { exact: true })).toBeVisible();
  await page.getByLabel("Search saved posts").fill("CRM record 001");
  await expect(
    page.getByRole("button", { name: "Edit CRM record 001", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1–1 of 1", { exact: true })).toBeVisible();
  await page.getByLabel("Filter by status").selectOption("approved");
  await page.getByLabel("Filter by platform").selectOption("LinkedIn");
  await page.getByLabel("Sort saved posts").selectOption("created_asc");
  await expect(page.locator(".crm-library-table tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("status", { name: "Loading Post Library" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/crm-library-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Card view", exact: true }).click();
  await expect(page.locator(".crm-library-card")).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/crm-library-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Edit CRM record 001", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Caption", { exact: true })
    .fill("First reviewed CRM edit.");
  await expect(
    dialog.getByRole("button", { name: "Approve saved draft", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Changes saved", { exact: true }),
  ).toBeVisible();
  const current = await (
    await page.request.get(root + `/posts/${posts[0].id}`)
  ).json();
  await page.request.patch(root + `/posts/${current.id}`, {
    headers,
    data: {
      ...editable(current),
      caption: "Newer server version",
      revision: current.revision,
      status: "draft",
    },
  });
  await dialog
    .getByLabel("Caption", { exact: true })
    .fill("Local conflict draft");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("changed");
  await expect(dialog.getByLabel("Caption", { exact: true })).toHaveValue(
    "Local conflict draft",
  );
  await dialog
    .getByRole("button", { name: "Reload saved revision", exact: true })
    .click();
  await expect(dialog.getByText(/Server revision loaded/)).toBeVisible();
  await expect(dialog.getByLabel("Caption", { exact: true })).toHaveValue(
    "Local conflict draft",
  );
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Changes saved", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Approve saved draft", exact: true })
    .click();
  await expect(
    dialog.getByText("Draft approved", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    dialog.getByText("Draft duplicated", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(root + "/post-library")).json()).total,
  ).toBe(27);
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(dialog.getByText("archived", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(dialog.getByText("draft", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Filter by status").selectOption("");
  await page
    .getByRole("link", { name: /Blocked/ })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Schedule details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Blocked", { exact: true }),
  ).toBeVisible();
});

test("retained generation history recovers one real saved draft and survives refresh", async ({
  page,
}) => {
  const { companyId, id } = await signInWorkspace(page);
  const backend = path.resolve(process.cwd(), "../backend");
  const fixture = JSON.parse(
    execFileSync(
      path.join(backend, ".venv/Scripts/python.exe"),
      ["scripts/seed_crm_browser_generation.py", companyId, id],
      { cwd: backend, encoding: "utf8" },
    ),
  );
  await page.goto("/dashboard/posts");
  await expect(
    page.getByText("No saved posts found", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Generation history", exact: true })
    .click();
  await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Review results", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Post title", { exact: true }),
  ).toHaveValue(fixture.title);
  await page
    .getByRole("button", { name: "Save recovered draft", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open saved draft", exact: true }),
  ).toBeVisible();
  const root = `${apiURL}/companies/${companyId}`;
  expect(await (await page.request.get(root + "/posts")).json()).toHaveLength(
    1,
  );
  await page
    .getByRole("link", { name: "Open saved draft", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review saved draft" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog").getByLabel("Post title", { exact: true }),
  ).toHaveValue(fixture.title);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: `Edit ${fixture.title}`, exact: true }),
  ).toBeVisible();
});

test("company directory shows real confirmation and honest analytics at mobile width", async ({
  page,
}) => {
  const { companyId, workspaceId } = await signInWorkspace(page);
  const second = await (
    await page.request.post(`${apiURL}/workspaces/${workspaceId}/companies`, {
      headers,
      data: {
        name: "CRM second company",
        description: "A separate client company for directory tests.",
      },
    })
  ).json();
  await page.goto("/dashboard/companies");
  await expect(
    page.getByRole("heading", { name: "Companies & Brands", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search companies").fill("CRM second");
  await page
    .getByRole("button", { name: "View CRM second company", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Needs Confirmation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(
    (
      await page.request.get(`${apiURL}/companies/${second.id}/post-library`)
    ).status(),
  ).toBe(200);
  expect(
    (
      await (
        await page.request.get(`${apiURL}/companies/${companyId}/post-library`)
      ).json()
    ).total,
  ).toBe(0);
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.getByLabel("Search companies").fill("");
  await expect(
    page.getByRole("heading", { name: "CRM second company", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/crm-companies-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Switch active workspace or company",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Active company")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/dashboard/analytics");
  await expect(
    page.getByText("No analytics integration connected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Example engagement", { exact: true }),
  ).toHaveCount(0);
});
