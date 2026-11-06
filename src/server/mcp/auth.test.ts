import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// verifyMcpToken through Clerk's real verifier: OAuth access tokens (at+jwt) signed with a test
// key, whose JWKS stands in for Clerk's /v1/jwks. Only the audience and the token type change
// between cases, so a failure here is our check, not a mock.

vi.mock("@/lib/env", () => ({
  env: {
    CLERK_SECRET_KEY: "sk_test_mcp_auth",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`,
  },
}));

const { MCP_URL } = await import("@/lib/app-url");
const { verifyMcpToken } = await import("./auth");

const kid = "ins_test_key";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).pathname.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

function accessToken(claims: { aud?: string | string[] }, typ = "at+jwt"): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid, typ });
  const body = b64({
    iss: "https://example.clerk.accounts.dev",
    sub: "user_alice",
    client_id: "https://claude.ai/oauth/claude-code-client-metadata",
    scope: "offline_access profile",
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 3600,
    ...claims,
  });
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

const request = (token?: string) =>
  new Request(MCP_URL, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe("verifyMcpToken", () => {
  it("accepts a token issued for MCP_URL", async () => {
    const auth = await verifyMcpToken(request(accessToken({ aud: MCP_URL })));
    expect(auth?.extra?.userId).toBe("user_alice");
    expect(auth?.scopes).toContain("profile");
  });

  it("accepts MCP_URL among several audiences", async () => {
    const auth = await verifyMcpToken(
      request(accessToken({ aud: ["https://other.example/api", MCP_URL] })),
    );
    expect(auth?.extra?.userId).toBe("user_alice");
  });

  // What a Clerk instance with aud_claim_enabled off issues, whatever resource the client asked
  // for: a valid token that names no resource. It could be replayed against any API that trusts
  // this Clerk instance, so it's refused.
  it("refuses a valid token with no audience", async () => {
    expect(await verifyMcpToken(request(accessToken({})))).toBeUndefined();
  });

  it("refuses a token issued for another resource", async () => {
    for (const aud of [
      "https://other.example/mcp",
      "http://localhost:3000/mcp/other",
      "https://localhost:3000/mcp",
    ]) {
      expect(await verifyMcpToken(request(accessToken({ aud })))).toBeUndefined();
    }
  });

  it("refuses a session token and a missing header", async () => {
    expect(await verifyMcpToken(request(accessToken({ aud: MCP_URL }, "JWT")))).toBeUndefined();
    expect(await verifyMcpToken(request())).toBeUndefined();
  });
});
