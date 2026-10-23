import { expect, test } from "@playwright/test";

test("signed-out visitors to /library end up on the sign-in page", async ({ page }) => {
  await page.goto("/library");

  // Clerk's dev instance may bounce through its handshake first; wait for the final URL.
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=.*%2Flibrary/);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /answers from your documents/i })).toBeVisible();
});
