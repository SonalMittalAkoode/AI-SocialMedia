import { test, expect } from "@playwright/test";
import { signInWorkspace, apiURL } from "./auth-helpers";

test("industry custom entry, editable HEX palette and real preferences survive refresh", async ({
  page,
}) => {
  const account = await signInWorkspace(page);
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto("/dashboard/brand");
  await page
    .getByRole("combobox", { name: "Industry", exact: true })
    .fill("Other");
  await page.getByLabel("Custom industry").fill("Museum education");
  await page
    .getByRole("button", { name: "Add brand color", exact: true })
    .click();
  await page.getByLabel("Brand color HEX 4", { exact: true }).fill("#123456");
  await page.getByLabel("Brand color HEX 4", { exact: true }).blur();
  await page
    .getByRole("button", { name: "Save brand changes", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `${apiURL}/companies/${account.companyId}/brand`,
            )
          ).json()
        ).brand_colors,
    )
    .toContain("#123456");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Industry", exact: true }),
  ).toHaveValue("Museum education");
  await expect(
    page.getByLabel("Brand color HEX 4", { exact: true }),
  ).toHaveValue("#123456");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Material brand edits require confirmation before later setup steps.
  await page.goto("/onboarding/brand");
  await page
    .getByRole("button", { name: "Confirm brand identity", exact: true })
    .click();
  await expect(page).toHaveURL(/onboarding\/competitors/);
  await page
    .getByRole("button", {
      name: "Continue to preferences",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/onboarding\/preferences/);
  await page
    .getByLabel("Content target audience", { exact: true })
    .fill("Museum visitors and teachers");
  await page
    .getByLabel(/Content topics/)
    .fill("Public collections, Art history");
  await page.getByLabel(/Topics to avoid/).fill("Unverified provenance");
  await page
    .getByLabel("Visual style preferences", { exact: true })
    .fill("Quiet editorial photography");
  await page
    .getByRole("button", { name: "Generate my first post", exact: true })
    .click();
  await expect(page).toHaveURL(/onboarding\/generate/);
  const prefs = await (
    await page.request.get(
      `${apiURL}/companies/${account.companyId}/preferences`,
    )
  ).json();
  expect(prefs.target_audience).toBe("Museum visitors and teachers");
  expect(prefs.content_topics).toEqual(["Public collections", "Art history"]);
  expect(prefs.excluded_topics).toEqual(["Unverified provenance"]);
  expect(prefs.visual_style).toBe("Quiet editorial photography");
  await page.goto("/onboarding/preferences");
  await expect(
    page.getByLabel("Content target audience", { exact: true }),
  ).toHaveValue(prefs.target_audience);
  await expect(
    page.getByText("Use real Gemini generation", { exact: true }),
  ).toHaveCount(0);
});
