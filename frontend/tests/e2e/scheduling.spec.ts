import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInWorkspace, apiURL } from "./auth-helpers";
import { addDays, dayInZone } from "../../src/lib/scheduling-api";
import { timeInZone } from "../../src/lib/scheduling-api";

test.use({ timezoneId: "America/Los_Angeles" });

test("live shared worker reaches Awaiting Publisher and company switching clears schedules", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { companyId, workspaceId } = await signInWorkspace(page);
  const root = `${apiURL}/companies/${companyId}`,
    headers = { Origin: "http://localhost:3000" };
  let post = await (
    await page.request.post(root + "/posts", {
      headers,
      data: {
        creation_key: randomUUID(),
        title: "Live due worker journey",
        platform: "LinkedIn",
        content_type: "text",
        caption: "A due transition with no publishing.",
        hashtags: [],
      },
    })
  ).json();
  post = await (
    await page.request.post(root + `/posts/${post.id}/approve`, {
      headers,
      data: { revision: post.revision },
    })
  ).json();
  const target = new Date(Math.ceil((Date.now() + 7000) / 60000) * 60000);
  const response = await page.request.post(root + "/schedules", {
    headers,
    data: {
      idempotency_key: randomUUID(),
      post_id: post.id,
      target_platform: post.platform,
      post_revision: post.revision,
      local_date: dayInZone(target, "UTC"),
      local_time: timeInZone(target.toISOString(), "UTC"),
      timezone: "UTC",
    },
  });
  expect(response.status()).toBe(201);
  const row = await response.json();
  const second = await (
    await page.request.post(`${apiURL}/workspaces/${workspaceId}/companies`, {
      headers,
      data: {
        name: "Schedule isolation company",
        description: "An independent scheduling company.",
      },
    })
  ).json();
  await page.goto("/dashboard/calendar");
  await expect(
    page.getByRole("button", {
      name: "View schedule Live due worker journey · Scheduled",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(root + `/schedules/${row.id}`)).json())
          .status,
      { timeout: 90000, intervals: [1000, 2000] },
    )
    .toBe("awaiting_publisher");
  await expect(
    page.getByRole("button", {
      name: "View schedule Live due worker journey · Awaiting Publisher",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", {
      name: "View schedule Live due worker journey · Awaiting Publisher",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "Publishing integration is not connected yet. This post remains saved and awaiting publication.",
        { exact: true },
      ),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/scheduling-awaiting-publisher.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.locator(".sidebar .workspace-button").click();
  await page.getByLabel("Active company").selectOption(second.id);
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("button", { name: /View schedule Live due worker journey/ }),
  ).toHaveCount(0);
  await page.locator(".sidebar .workspace-button").click();
  await page.getByLabel("Active company").selectOption(companyId);
  await page.goto("/dashboard/calendar");
  await expect(
    page.getByRole("button", {
      name: "View schedule Live due worker journey · Awaiting Publisher",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(
        `${apiURL}/companies/${second.id}/schedules/${row.id}`,
      )
    ).status(),
  ).toBe(404);
});
test("approved post scheduling persists, reschedules, cancels and isolates companies", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const { companyId } = await signInWorkspace(page);
  const root = `${apiURL}/companies/${companyId}`,
    headers = { Origin: "http://localhost:3000" };
  const response = await page.request.post(root + "/posts", {
    headers,
    data: {
      creation_key: randomUUID(),
      title: "Calendar persistence journey",
      platform: "LinkedIn",
      content_type: "text",
      caption: "An approved, saved scheduling test.",
      hashtags: [],
    },
  });
  expect(response.status()).toBe(201);
  let post = await response.json();
  post = await (
    await page.request.post(root + `/posts/${post.id}/approve`, {
      headers,
      data: { revision: post.revision },
    })
  ).json();
  const date = addDays(dayInZone(new Date(), "Asia/Kolkata"), 2);
  await page.goto("/dashboard/posts");
  await page
    .getByRole("button", { name: "Edit Calendar persistence journey" })
    .click();
  await expect(page.getByLabel("Schedule timezone (IANA)")).toHaveValue(
    "Asia/Kolkata",
  );
  await page.getByLabel("Schedule date", { exact: true }).fill(date);
  await page.getByLabel("Schedule time", { exact: true }).fill("01:30");
  await page
    .getByRole("button", { name: "Confirm schedule", exact: true })
    .dblclick();
  await expect(
    page.getByText("Post scheduled in your company calendar.", {
      exact: false,
    }),
  ).toBeVisible();
  const schedules = await (await page.request.get(root + "/schedules")).json();
  expect(schedules).toHaveLength(1);
  const id = schedules[0].id;
  expect(schedules[0].scheduled_at).toBe(addDays(date, -1) + "T20:00:00Z");
  await page.goto("/dashboard/calendar");
  const event = page.getByRole("button", {
    name: "View schedule Calendar persistence journey · Scheduled",
    exact: true,
  });
  await expect(event).toBeVisible();
  await expect(event).toContainText("01:30");
  await page.reload();
  await expect(event).toBeVisible();
  await event.click();
  await expect(
    page.getByRole("heading", { name: "Schedule details", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Schedule time", { exact: true }).fill("02:30");
  await page
    .getByRole("button", { name: "Save new schedule time", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(root + `/schedules/${id}`)).json())
          .revision,
    )
    .toBe(2);
  await expect(page.getByLabel("Schedule time", { exact: true })).toHaveValue(
    "02:30",
  );
  await page
    .getByRole("button", { name: "Cancel schedule", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Cancelled", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", {
      name: "View schedule Calendar persistence journey · Cancelled",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Calendar status").selectOption("scheduled");
  await expect(event).toHaveCount(0);
  await page.getByLabel("Calendar status").selectOption("cancelled");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/scheduling-calendar-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "artifacts/scheduling-calendar-desktop.png",
    fullPage: true,
  });
  expect((await page.request.get(root + `/posts/${post.id}`)).status()).toBe(
    200,
  );
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const foreign = await signInWorkspace(other);
  expect((await other.request.get(root + `/schedules/${id}`)).status()).toBe(
    404,
  );
  expect(
    (
      await page.request.get(
        `${apiURL}/companies/${foreign.companyId}/schedules/${id}`,
      )
    ).status(),
  ).toBe(404);
  await otherContext.close();
});

test("calendar creates only from approved posts and preserves entered data on errors", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  const root = `${apiURL}/companies/${companyId}`;
  await page.goto("/dashboard/calendar");
  await page.getByRole("button", { name: "Plan a post", exact: true }).click();
  await expect(
    page.getByText("No approved posts on this page", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const response = await page.request.post(root + "/posts", {
    headers: { Origin: "http://localhost:3000" },
    data: {
      creation_key: randomUUID(),
      title: "Date picker test",
      platform: "Instagram",
      content_type: "text",
      caption: "A saved test draft.",
      hashtags: [],
    },
  });
  const p = await response.json();
  await page.request.post(root + `/posts/${p.id}/approve`, {
    headers: { Origin: "http://localhost:3000" },
    data: { revision: p.revision },
  });
  await page.getByRole("button", { name: "Plan a post", exact: true }).click();
  await page.getByLabel("Choose an approved post").selectOption(p.id);
  await page.getByLabel("Schedule date", { exact: true }).fill("2000-01-01");
  await page
    .getByRole("button", { name: "Confirm schedule", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("future");
  await expect(page.getByLabel("Schedule date", { exact: true })).toHaveValue(
    "2000-01-01",
  );
  await page
    .getByLabel("Schedule date", { exact: true })
    .fill(addDays(dayInZone(new Date(), "Asia/Kolkata"), 3));
  await page
    .getByRole("button", { name: "Confirm schedule", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "View schedule Date picker test · Scheduled",
      exact: true,
    }),
  ).toBeVisible();
});
