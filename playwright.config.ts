import { defineConfig, devices } from "@playwright/test";

// Runs against `pnpm dev` (started here, or reused if it's already running). Set E2E_BASE_URL
// to test a server you started yourself instead, e.g. `pnpm build && pnpm start`.
// Needs the Clerk keys in .env.local. Not part of CI yet.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "corepack pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
