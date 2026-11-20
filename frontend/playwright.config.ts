import { defineConfig } from "@playwright/test";
const baseURL = process.env.SOCIALAI_E2E_BASE_URL || "http://localhost:3000";
const port = new URL(baseURL).port || "3000";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL,
    headless: true,
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Kolkata",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
