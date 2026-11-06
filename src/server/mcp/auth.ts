import "server-only";

import { createClerkClient } from "@clerk/backend";
import type { AuthInfo } from "@modelcontextprotocol/server";

import { env } from "@/lib/env";
import { MCP_URL } from "@/lib/app-url";

// OAuth for the MCP server (docs/adr/0008), as in Clerk's "Build and authenticate an MCP server"
// guide. Clerk signs the user in and asks them to approve the app; this checks the access token
// the app then sends with every request.

// What a token must grant. The tools only need to know who the user is, so we don't ask for
// email or anything else. Clients that send no scope get Clerk's default scopes (set those in
// the dashboard: docs/security.md).
export const REQUIRED_SCOPES = ["profile"];
// Advertised in the protected-resource metadata. offline_access lets the app refresh its token
// instead of asking the user to sign in again.
export const SUPPORTED_SCOPES = ["profile", "offline_access"];

const clerk = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

// Accepts only OAuth access tokens our Clerk instance issued for exactly MCP_URL: it checks the
// signature, expiry and that `aud` includes MCP_URL, and rejects tokens with no audience. Never
// trusts a user id from anywhere else.
export async function verifyMcpToken(request: Request): Promise<AuthInfo | undefined> {
  try {
    const state = await clerk.authenticateRequest(request, {
      acceptsToken: "oauth_token",
      audience: MCP_URL,
    });
    if (!state.isAuthenticated) return undefined;
    const { clientId, scopes, userId } = state.toAuth();
    if (!userId) return undefined;
    return { token: state.token, clientId, scopes, extra: { userId } };
  } catch (error) {
    console.error("MCP access token verification failed", error);
    return undefined;
  }
}

// The verified user, from the auth info withMcpAuth attached to the request. Throws when there
// is none, which withMcpAuth({ required: true }) already prevents.
export function userIdFrom(authInfo: AuthInfo | undefined): string {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("MCP request without a verified user");
  }
  return userId;
}
