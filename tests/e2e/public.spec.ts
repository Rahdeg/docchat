import AxeBuilder from "@axe-core/playwright";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { expect, test, type Page } from "@playwright/test";

import { watchCsp } from "./csp";

// The public pages (docs/design/public): the landing page, /how-we-test, sign-in and sign-up,
// the error pages, and the files crawlers and link previews read. Run against a production
// build (`pnpm build && pnpm start`, E2E_BASE_URL=http://localhost:3000) for the real CSP and
// static output.

// Clerk's browser SDK, loaded by ClerkProvider: the public and error pages must not load it.
function watchClerkScripts(page: Page): () => string[] {
  const loaded: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (request.resourceType() === "script" && /clerk/i.test(url)) loaded.push(url);
  });
  return () => [...loaded];
}

async function expectNoClerk(page: Page, clerkScripts: () => string[]) {
  await page.waitForLoadState("networkidle");
  expect(clerkScripts()).toEqual([]);
  expect(await page.evaluate(() => "Clerk" in window)).toBe(false);
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  const violations = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(violations).toEqual([]);
}

test.describe("signed out", () => {
  test("/ renders the landing page with measured results and no Clerk JavaScript", async ({
    page,
  }) => {
    const clerkScripts = watchClerkScripts(page);
    const violations = watchCsp(page);
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ask your documents. Check every answer.",
    );
    await expect(page.locator("h1")).toHaveCount(1);
    for (const name of [
      "Three steps from a pile of paper to an answer you can check",
      "Measured, not promised",
      "More than answers",
      "Your documents stay yours",
      "Ask your first question in under a minute.",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /an answer pointing to the clause/ })).toBeVisible();

    // Every card shows the date of the run it came from.
    const cards = page.locator("[data-metric]");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      await expect(card).toContainText(/Last measured \d{1,2} [A-Z][a-z]{2} \d{4}/);
    }
    await expect(page.getByRole("link", { name: "Read how it's tested" })).toHaveAttribute(
      "href",
      "/how-we-test",
    );
    await expect(page.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Rahdeg",
    );

    await expectNoClerk(page, clerkScripts);
    expect(violations()).toEqual([]);
  });

  test("the first Tab reaches the skip link, which moves focus to the main content", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("/ has a title, a description and an Open Graph image", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DocChat/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /\/opengraph-image/,
    );
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon/);
  });

  test("/how-we-test explains each eval, with no Clerk JavaScript", async ({ page }) => {
    const clerkScripts = watchClerkScripts(page);
    await page.goto("/how-we-test");
    await expect(page).toHaveTitle("How DocChat is tested | DocChat");
    await expect(page.locator("h1")).toHaveCount(1);
    for (const name of [
      "Finding the right page",
      "Citing sources, and saying “I don’t know”",
      "Turning documents into tasks",
      "Ignoring hidden instructions",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expectNoClerk(page, clerkScripts);
  });

  test("an unknown public page shows the not-found page, with no Clerk JavaScript", async ({
    page,
  }) => {
    const clerkScripts = watchClerkScripts(page);
    const response = await page.goto("/how-we-test/missing");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn’t find that page");
    await expect(page.getByRole("link", { name: "Go to your library" })).toHaveAttribute(
      "href",
      "/library",
    );
    await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await expectNoClerk(page, clerkScripts);
  });

  test("sign-up renders Clerk's form under our heading", async ({ page }) => {
    const violations = watchCsp(page);
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your DocChat account");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    expect(violations()).toEqual([]);
  });

  test("the desk panel is hidden below 900px; the logo still links home", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to DocChat" })).toBeVisible();
    await expect(page.getByRole("region", { name: "About DocChat" })).toBeHidden();
    await expect(page.getByRole("link", { name: "DocChat" })).toHaveAttribute("href", "/");
  });

  test("robots.txt keeps crawlers out of the app and points at the sitemap", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const text = await response.text();
    for (const path of ["/library", "/chat", "/tasks", "/settings", "/api/"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    expect(text).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  });

  test("the sitemap lists only public pages", async ({ request }) => {
    const response = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => new URL(m[1]!).pathname,
    );
    expect(locs.sort()).toEqual(["/", "/how-we-test", "/sign-in", "/sign-up"]);
  });

  test("the Open Graph image and icons are served signed out", async ({ request }) => {
    for (const [path, type] of [
      ["/opengraph-image", "image/png"],
      ["/apple-icon", "image/png"],
      ["/icon.svg", "image/svg+xml"],
    ] as const) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toContain(type);
    }
  });
});

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  for (const path of ["/", "/how-we-test", "/sign-in"]) {
    test(`${path} has no axe violations`, async ({ page }) => {
      await page.goto(path);
      if (path === "/sign-in") {
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
      await page.waitForLoadState("networkidle");
      await expectAccessible(page);
    });
  }

  test("/ has no axe violations on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expectAccessible(page);
  });
});

// Signed-in checks need a Clerk development user (E2E_CLERK_USER_EMAIL), as signed-in.spec.ts.
const email = process.env.E2E_CLERK_USER_EMAIL;

test.describe("signed in", () => {
  test.skip(!email, "Set E2E_CLERK_USER_EMAIL to a Clerk development user without MFA");

  async function signIn(page: Page) {
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: email! });
  }

  test("visiting / redirects to /library", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  });

  test("app pages are noindex", async ({ page }) => {
    await signIn(page);
    await page.goto("/library");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page).toHaveTitle("Library | DocChat");
  });

  test("the user menu signs out and returns to the landing page", async ({ page }) => {
    await signIn(page);
    await page.goto("/library");
    await page.locator(".cl-userButtonTrigger").click();
    await page.getByRole("dialog", { name: "Account panel" }).getByText("Sign out").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ask your documents. Check every answer.",
    );
    // Signed out for real: the app sends us to sign-in again.
    await page.goto("/library");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a new account can sign up through the form", async ({ page }) => {
    test.setTimeout(90_000);
    // Clerk's test addresses (+clerk_test) take the code 424242 and send no email.
    const address = `docchat-e2e-signup-${Date.now()}+clerk_test@example.com`;
    const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    await setupClerkTestingToken({ page });

    await page.goto("/sign-up");
    await page.getByLabel("Email address").fill(address);
    const password = page.getByLabel("Password", { exact: true });
    if (await password.isVisible()) await password.fill(`Dc-${crypto.randomUUID()}`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Email verification step: one input per digit, or a single code field.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/verify|check your email/i);
    await page.keyboard.type("424242");
    try {
      await expect(page).toHaveURL(/\/library$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
    } finally {
      const { data } = await clerkClient.users.getUserList({ emailAddress: [address] });
      await Promise.all(data.map((user) => clerkClient.users.deleteUser(user.id)));
    }
  });
});
