import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { initialState } from "../../src/data/fixtures";
import { serializeState } from "../../src/lib/storage";
import {
  companyCacheKey,
  selectionKey,
  brandPayload,
  companyPayload,
  preferencePayload,
} from "../../src/lib/company-state";
export const apiURL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export const testPassword = "TestPassword123!";
export function uniqueEmail() {
  return `e2e-${randomUUID()}@example.com`;
}
export async function signInWorkspace(page: Page) {
  const email = uniqueEmail();
  const headers = { Origin: "http://localhost:3000" };
  const registration = await page.request.post(`${apiURL}/auth/register`, {
    headers,
    data: { full_name: "Alex Morgan", email, password: testPassword },
  });
  expect(registration.status()).toBe(201);
  const user = await registration.json();
  const login = await page.request.post(`${apiURL}/auth/login`, {
    headers,
    data: { email, password: testPassword },
  });
  expect(login.status()).toBe(200);
  const state = initialState();
  const w = await page.request.post(`${apiURL}/workspaces`, {
    headers,
    data: { name: "Browser test workspace", idempotency_key: randomUUID() },
  });
  expect(w.status()).toBe(201);
  const workspace = await w.json();
  const c = await page.request.post(
    `${apiURL}/workspaces/${workspace.id}/companies`,
    {
      headers,
      data: { ...companyPayload(state), idempotency_key: randomUUID() },
    },
  );
  expect(c.status()).toBe(201);
  const company = await c.json();
  const path = `${apiURL}/companies/${company.id}`;
  const b = await page.request.patch(`${path}/brand`, {
    headers,
    data: { ...brandPayload(state), revision: 1 },
  });
  expect(b.status()).toBe(200);
  expect(
    (
      await page.request.post(`${path}/brand/confirm`, {
        headers,
        data: { revision: (await b.json()).revision },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.put(`${path}/preferences`, {
        headers,
        data: { ...preferencePayload(state), revision: 1 },
      })
    ).status(),
  ).toBe(200);
  for (const step of [
    "business",
    "brand",
    "competitors",
    "preferences",
    "generate",
  ]) {
    const progress = await (
      await page.request.get(`${path}/onboarding`)
    ).json();
    expect(
      (
        await page.request.post(`${path}/onboarding/complete-step`, {
          headers,
          data: { revision: progress.revision, step, demo_acknowledged: true },
        })
      ).status(),
    ).toBe(200);
  }
  const progress = await (await page.request.get(`${path}/onboarding`)).json();
  expect(
    (
      await page.request.post(`${path}/onboarding/complete`, {
        headers,
        data: { revision: progress.revision },
      })
    ).status(),
  ).toBe(200);
  state.onboarding = { step: 4, completed: true };
  await page.addInitScript(
    ({ key, raw }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
    },
    { key: companyCacheKey(user.id, company.id), raw: serializeState(state) },
  );
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: selectionKey(user.id),
      value: { workspaceId: workspace.id, companyId: company.id },
    },
  );
  return {
    email,
    id: user.id,
    companyId: company.id,
    workspaceId: workspace.id,
  };
}
