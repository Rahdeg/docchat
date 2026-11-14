import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

import { AUTH_FILE } from "./tests/e2e/paths";

// The Clerk keys (and E2E_CLERK_USER_EMAIL) from .env.local, for the signed-in specs.
loadEnvConfig(process.cwd());

// Runs against `pnpm dev` locally (started here, or reused if it's already running) and against
// `pnpm start` in CI, where the job builds first, so the production CSP applies. Set
// E2E_BASE_URL to test a server you started yourself instead, e.g. `pnpm build && pnpm start`.
// CI uses the fake AI providers and the local file store (docs/adr/0009).
const ci = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// The flows (and their retries, and reruns on the same day) ask more than a day's free
// allowance, so the server these tests start gets more of it. The limits the flows test keep
// their defaults: 3 documents and 5 questions a minute (docs/adr/0010). An env var still wins.
// A server you started yourself (E2E_BASE_URL, or a reused `pnpm dev`) keeps its own settings.
const e2eLimits = {
  QUESTIONS_PER_DAY: process.env.QUESTIONS_PER_DAY ?? "500",
  AGENT_RUNS_PER_DAY: process.env.AGENT_RUNS_PER_DAY ?? "100",
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: ci ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Signs the e2e user in once and saves the session for the flows.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /flows\.spec\.ts|auth\.setup\.ts/,
    },
    // The signed-in user flows: one user, one serial file.
    {
      name: "flows",
      testMatch: /flows\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: ci ? "corepack pnpm start" : "corepack pnpm dev",
        url: baseURL,
        reuseExistingServer: !ci,
        timeout: 120_000,
        env: e2eLimits,
      },
});
