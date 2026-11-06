import { expect, test } from "@playwright/test";

import { watchCsp } from "./csp";

// Security headers, the MCP server's public surface and the Clerk webhook, signed out. Run it
// against a production build too: E2E_BASE_URL=http://localhost:3000 after `pnpm build && pnpm
// start`, since dev adds 'unsafe-eval' to the policy.

test("pages send the security headers", async ({ request }) => {
  const response = await request.get("/sign-in");
  const headers = response.headers();

  const policy = headers["content-security-policy"] ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
});

for (const path of ["/sign-in", "/sign-up"]) {
  test(`${path} renders Clerk with no CSP violations`, async ({ page }) => {
    const violations = watchCsp(page);

    await page.goto(path);
    await expect(page.locator(".cl-rootBox, [data-clerk-component]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(violations()).toEqual([]);
  });
}

test.describe("MCP server", () => {
  test("/mcp without a token answers 401 and points at its metadata", async ({ request }) => {
    const response = await request.post("/mcp", {
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers: { accept: "application/json, text/event-stream" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(
      /resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
  });

  test("a forged token is refused", async ({ request }) => {
    const response = await request.post("/mcp", {
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer oat_forged_token",
      },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(401);
  });

  test("the protected-resource metadata names /mcp and Clerk, with CORS", async ({ request }) => {
    const response = await request.get("/.well-known/oauth-protected-resource/mcp");
    expect(response.status()).toBe(200);
    expect(response.headers()["access-control-allow-origin"]).toBe("*");

    const metadata = (await response.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(metadata.resource).toMatch(/\/mcp$/);
    expect(metadata.authorization_servers[0]).toMatch(/^https:\/\/.*clerk/);
    expect(metadata.scopes_supported).toContain("profile");

    const preflight = await request.fetch("/.well-known/oauth-protected-resource/mcp", {
      method: "OPTIONS",
    });
    expect(preflight.status()).toBe(200);
  });

  test("the authorization server metadata comes from Clerk", async ({ request }) => {
    const response = await request.get("/.well-known/oauth-authorization-server");
    expect(response.status()).toBe(200);

    const metadata = (await response.json()) as { issuer: string; authorization_endpoint: string };
    expect(metadata.issuer).toMatch(/^https:\/\/.*clerk/);
    expect(metadata.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
  });
});

test("the Clerk webhook refuses an unsigned delivery", async ({ request }) => {
  const response = await request.post("/api/webhooks/clerk", {
    data: { type: "user.deleted", data: { id: "user_someone" } },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(400);
});
