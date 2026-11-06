import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { watchCsp } from "./csp";

// Signed-in pages under the Content-Security-Policy, with a real upload to Vercel Blob. Needs a
// Clerk user on the development instance with no MFA, named in E2E_CLERK_USER_EMAIL (Clerk's
// test addresses, like docchat-e2e+clerk_test@example.com, work). clerk.signIn signs in with a
// server-side token (CLERK_SECRET_KEY), so no password or email code is needed.
const email = process.env.E2E_CLERK_USER_EMAIL;

test.describe("signed in", () => {
  test.skip(!email, "Set E2E_CLERK_USER_EMAIL to a Clerk development user without MFA");

  async function signIn(page: Page) {
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: email! });
  }

  for (const [path, heading] of [
    ["/library", "Library"],
    ["/chat", null],
    ["/tasks", "Tasks"],
    ["/settings", "Settings"],
  ] as const) {
    test(`${path} loads with no CSP violations`, async ({ page }) => {
      const violations = watchCsp(page);
      await signIn(page);

      await page.goto(path);
      if (heading)
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      else await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
      await page.waitForLoadState("networkidle");

      expect(violations()).toEqual([]);
    });
  }

  test("Settings shows the MCP URL, and the user menu links to it", async ({ page }) => {
    await signIn(page);
    await page.goto("/library");

    await page.locator(".cl-userButtonTrigger").click();
    await page.getByRole("dialog", { name: "Account panel" }).getByText("Settings").click();
    await expect(page).toHaveURL(/\/settings$/);

    await expect(page.getByLabel("Server URL", { exact: true })).toHaveValue(/\/mcp$/);
    await expect(page.getByLabel("Claude Code command", { exact: true })).toHaveValue(
      /^claude mcp add --transport http docchat https?:\/\/.+\/mcp$/,
    );
    await page.getByRole("button", { name: "Manage account" }).click();
    await expect(page.locator(".cl-userProfile-root, .cl-modalContent").first()).toBeVisible();
  });

  test("uploads a PDF straight to Blob, reads it and removes it, with no CSP violations", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const violations = watchCsp(page);
    await signIn(page);
    await page.goto("/library");

    // Cards are articles headed with the document's name, without its extension. Their actions
    // show on hover.
    const cards = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: /^two-pages/ }) });
    const remove = async () => {
      await cards.first().hover();
      await cards.first().getByRole("button", { name: "More actions for two-pages" }).click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
      await expect(page.getByRole("alertdialog")).toBeHidden();
    };
    // The file input's handler is attached once the page has hydrated.
    await page.waitForLoadState("networkidle");
    // Left over from an earlier run that stopped halfway.
    while ((await cards.count()) > 0) await remove();

    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/two-pages.pdf");
    await expect(cards).toHaveCount(1);
    // Indexing embeds the fixture's two pages (fictional text).
    await expect(cards.first().getByText("Ready", { exact: true })).toBeVisible({
      timeout: 90_000,
    });

    await remove();
    await expect(cards).toHaveCount(0);

    expect(violations()).toEqual([]);
  });
});
