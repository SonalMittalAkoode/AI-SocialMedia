import { expect, test } from "@playwright/test";
import { signInWorkspace } from "./auth-helpers";

test("trend research uses explicit cited search and keeps independent notes scoped across refresh", async ({
  page,
}) => {
  await signInWorkspace(page);
  const reported = "Packaging update announced on 2026-11-18.";
  const text = `## Reported evidence\n\n${reported}\n\n## Suggested post angles\n\n- Explain the change in a practical guide.`;
  const starts = text.indexOf(reported);
  let requests = 0;
  let fails = true;
  let reviewedNote: string | undefined;
  await page.route("**/trend-search", async (route) => {
    requests += 1;
    const body = route.request().postDataJSON();
    reviewedNote = body.note_id;
    expect(body.days).toBe(7);
    if (fails) {
      await route.fulfill({
        status: 429,
        json: { detail: "Search quota reached. Try later." },
      });
    } else {
      await route.fulfill({
        json: {
          text,
          provider: "openai",
          display_only: true,
          sources: [
            {
              uri: "https://www.example.com/release",
              title: "Publisher release",
            },
          ],
          citations: [
            {
              start: starts,
              end: starts + reported.length,
              source_indices: [0],
            },
          ],
          search_suggestions_html: "",
        },
      });
    }
  });
  await page.goto("/dashboard/trends");
  await expect(
    page.getByRole("heading", { name: "Trend Research", exact: true }),
  ).toBeVisible();
  const search = page.getByRole("button", { name: "Search for trends" });
  await expect(search).toBeEnabled();
  expect(requests).toBe(0);
  await page.getByLabel("Date range").selectOption("7");
  await page.getByLabel("Focus topic (optional)").fill("Packaging");
  await search.click();
  await expect(page.getByRole("alert").filter({ hasText: "Search quota reached" })).toBeVisible();
  fails = false;
  await search.click();
  const result = page.getByRole("article", {
    name: "OpenAI web search results",
  });
  await expect(result.getByText(reported)).toBeVisible();
  await expect(
    result.getByRole("link", { name: "Source 1: Publisher release" }),
  ).toHaveAttribute("href", "https://www.example.com/release");
  await expect(result.getByText("Suggested post angles")).toBeVisible();

  await page.getByRole("button", { name: "Add research note" }).click();
  await page.getByLabel("Note title").fill("Independent packaging summary");
  await page
    .getByLabel("Independent source URL")
    .fill("https://www.example.com/independent");
  await page.getByLabel("Publication date (optional)").fill("2025-01-01");
  await page
    .getByLabel("Finding in your own words")
    .fill(
      "A review of the independent bulletin identified a packaging change.",
    );
  await page.getByRole("checkbox", { name: /independently reviewed/ }).check();
  await page.getByRole("button", { name: "Save research note" }).click();
  const note = page.getByRole("region", { name: "Reviewed research notes" });
  await expect(
    note.getByRole("heading", { name: "Independent packaging summary" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Research post angles" }).click();
  await expect(
    page.getByText("Post angles for", { exact: false }),
  ).toBeVisible();
  expect(reviewedNote).toBeTruthy();
  await page.getByRole("button", { name: "Dismiss search results" }).click();
  await expect(result).toHaveCount(0);
  await page.reload();
  await expect(note.getByText("2025-01-01")).toBeVisible();
  await expect(result).toHaveCount(0);
  expect(requests).toBe(3);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await note.getByRole("link", { name: "Open brief in Studio" }).click();
  await expect(page.getByLabel("What's the story?")).toHaveValue(
    "Independent packaging summary",
  );
  await page.goto("/dashboard/trends");
  await note
    .getByRole("button", {
      name: /Dismiss note: Independent packaging summary/,
    })
    .click();
  await expect(note.getByText("No reviewed notes on this page.")).toBeVisible();
});
