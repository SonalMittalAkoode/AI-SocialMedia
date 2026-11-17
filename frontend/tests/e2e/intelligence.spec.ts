import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInWorkspace, apiURL } from "./auth-helpers";
import { addDays, dayInZone } from "../../src/lib/scheduling-api";

test("manual competitors persist, approve, reject and survive refresh", async ({
  page,
}) => {
  await signInWorkspace(page);
  await page.goto("/dashboard/competitors");
  await page
    .getByRole("button", { name: "Add competitor", exact: true })
    .click();
  await page.getByLabel("Company name").fill("Evidence Business");
  await page.getByLabel("Competitor website").fill("https://business.org");
  await page
    .getByRole("button", { name: "Save competitor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence Business" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve competitor", exact: true })
    .click();
  await page.reload();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View Evidence Business" }).click();
  await expect(page.getByText(/Research unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("rejected", { exact: true })).toBeVisible();
});

test("real studio contract restores generated results and saves editable PostgreSQL drafts", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  const id = randomUUID();
  let generated = false;
  const draft = {
    title: "A real draft contract",
    platform: "Instagram",
    content_type: "educational",
    caption: "Meet our thoughtful coffee team.",
    hashtags: ["#Coffee"],
    hook: "Meet our team",
    call_to_action: "Share your thoughts",
    image_prompt: "Abstract coffee illustration",
    slides: [],
  };
  const job = {
    id,
    company_id: companyId,
    kind: "content_generation",
    status: "completed",
    stage: "completed",
    attempt_count: 1,
    error_code: null,
    error_message: null,
  };
  // Routine browser verification never spends provider quota. Persistence uses the real API.
  await page.route("**/ai-jobs?kind=content_generation", (r) =>
    r.fulfill({ json: generated ? [job] : [] }),
  );
  await page.route("**/content-generations", async (r) => {
    generated = true;
    await r.fulfill({ status: 202, json: job });
  });
  await page.route(`**/content-generations/${id}/result`, (r) =>
    r.fulfill({
      json: {
        posts: [draft],
        strategy: {},
        warnings: ["Human review required"],
      },
    }),
  );
  await page.goto("/dashboard/content-studio");
  await page.getByLabel("What's the story?").fill("Our coffee team");
  await page
    .getByRole("button", { name: "Generate content", exact: true })
    .click();
  await expect(page.getByLabel("Post title", { exact: true })).toHaveValue(
    draft.title,
  );
  await page.reload();
  await expect(page.getByLabel("Post title", { exact: true })).toHaveValue(
    draft.title,
  );
  // The provider contract fixture has no real AIJob. Bridge this one fixture save
  // into the real manual-draft API; backend tests cover actual job provenance.
  await page.route(`${apiURL}/companies/${companyId}/posts`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON();
    delete body.generation_job_id;
    delete body.result_index;
    const response = await route.fetch({ postData: JSON.stringify(body) });
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review & schedule saved draft", exact: true })
    .click();
  const review = page.getByRole("dialog");
  await review
    .getByRole("button", { name: "Approve saved draft", exact: true })
    .click();
  await expect(review.getByLabel("Schedule timezone (IANA)")).toHaveValue(
    "Asia/Kolkata",
  );
  await review
    .getByLabel("Schedule date", { exact: true })
    .fill(addDays(dayInZone(new Date(), "Asia/Kolkata"), 4));
  await review
    .getByRole("button", { name: "Confirm schedule", exact: true })
    .click();
  await expect(
    review.getByText("Post scheduled in your company calendar.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    await (
      await page.request.get(`${apiURL}/companies/${companyId}/posts`)
    ).json(),
  ).toHaveLength(1);
  await review.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/dashboard/posts");
  await page.getByRole("button", { name: "Edit " + draft.title }).click();
  await page
    .getByLabel("Caption", { exact: true })
    .fill("A carefully edited introduction.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
  // Exercise the unavailable-provider UI without spending configured image quota.
  await page.route("**/posts/*/images", (r) =>
    r.fulfill({
      status: 503,
      json: { detail: "image_provider_not_configured" },
    }),
  );
  await page
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "image_provider_not_configured" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(
    page.getByText("A carefully edited introduction.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit " + draft.title }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByText("archived", { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("draft", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 375, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/real-posts-mobile.png",
    fullPage: true,
  });
});
