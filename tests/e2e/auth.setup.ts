import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { clerk } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

import { AUTH_FILE } from "./paths";

// Signs the e2e user in (a server-side sign-in token, no password or email code) and saves the
// browser state, so the flows start signed in. global-setup.ts creates the user if needed.
const email = process.env.E2E_CLERK_USER_EMAIL;

setup("sign in the e2e user", async ({ page }) => {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  if (!email) {
    // The flows skip themselves without a user; give them an empty state to load.
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
