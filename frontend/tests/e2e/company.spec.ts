import { test, expect } from "@playwright/test";
import { signInWorkspace, apiURL } from "./auth-helpers";
test("server data wins over browser drafts; explicit recovery and saving require reconfirmation", async ({
  page,
}) => {
  const { companyId, workspaceId } = await signInWorkspace(page);
  await page.goto("/dashboard/brand");
  await page
    .getByLabel("Company name *", { exact: true })
    .fill("Recovered brand");
  await page.reload();
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    "Brew & Bean",
  );
  await page
    .getByRole("button", { name: "Review local draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep server version" }).click();
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    "Brew & Bean",
  );
  await page
    .getByRole("button", { name: "Review local draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore draft for review" }).click();
  await expect(page.getByLabel("Company name *", { exact: true })).toHaveValue(
    "Recovered brand",
  );
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/companies/${companyId}/brand`) &&
        response.request().method() === "PATCH",
    ),
    page.getByRole("button", { name: "Save brand changes" }).click(),
  ]);
  expect(saved.status()).toBe(200);
  await expect(page).toHaveURL("/dashboard/brand");
  const brand = await (
    await page.request.get(`${apiURL}/companies/${companyId}/brand`)
  ).json();
  expect(brand.display_name).toBe("Recovered brand");
  expect(brand.is_confirmed).toBe(false);
  expect(
    await (
      await page.request.get(`${apiURL}/workspaces/${workspaceId}/companies`)
    ).json(),
  ).toHaveLength(1);
});
for (const width of [375, 1440])
  test(`company selection and tenant isolation at ${width}px`, async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { companyId, workspaceId } = await signInWorkspace(page);
    const headers = { Origin: "http://localhost:3000" };
    const response = await page.request.post(
      `${apiURL}/workspaces/${workspaceId}/companies`,
      {
        headers,
        data: {
          name: "Second company",
          description: "An independent company in the same workspace.",
        },
      },
    );
    expect(response.status()).toBe(201);
    const second = await response.json();
    await page.goto("/dashboard");
    if (width < 768)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await page.locator(".sidebar .workspace-button").click();
    await page.getByLabel("Active company").selectOption(second.id);
    await expect(page).toHaveURL("/dashboard");
    await expect(
      page.getByRole("link", { name: "Continue company setup" }),
    ).toBeVisible();
    if (width < 768)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await page.locator(".sidebar .workspace-button").click();
    await page.getByLabel("Active company").selectOption(companyId);
    await expect(page).toHaveURL("/dashboard");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInWorkspace(other);
    for (const suffix of ["", "/brand", "/preferences", "/onboarding"])
      expect(
        (
          await other.request.get(`${apiURL}/companies/${companyId}${suffix}`)
        ).status(),
      ).toBe(404);
    expect(
      (
        await other.request.patch(`${apiURL}/companies/${companyId}/brand`, {
          headers,
          data: { revision: 1, display_name: "Intrusion" },
        })
      ).status(),
    ).toBe(404);
    await context.close();
  });
test("stale brand edits return a conflict and preserve both server data and the browser draft", async ({
  page,
}) => {
  const { companyId } = await signInWorkspace(page);
  await page.goto("/dashboard/brand");
  await expect(page.getByLabel("Target audience")).toBeVisible();
  const old = await (
    await page.request.get(`${apiURL}/companies/${companyId}/brand`)
  ).json();
  const headers = { Origin: "http://localhost:3000" };
  expect(
    (
      await page.request.patch(`${apiURL}/companies/${companyId}/brand`, {
        headers,
        data: {
          revision: old.revision,
          target_audience: "Newer server audience",
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByLabel("Target audience").fill("Unsaved local audience");
  await page.getByRole("button", { name: "Save brand changes" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed in another session" }),
  ).toBeVisible();
  await expect(page.getByLabel("Target audience")).toHaveValue(
    "Unsaved local audience",
  );
  expect(
    (
      await (
        await page.request.get(`${apiURL}/companies/${companyId}/brand`)
      ).json()
    ).target_audience,
  ).toBe("Newer server audience");
});
