import { env } from "@/lib/env";

// The app's public origin: APP_URL, or Vercel's production domain, or localhost in development.
// Preview deployments use the production domain too: OAuth tokens for the MCP server are issued
// for one URL (their audience), the one registered in Clerk (docs/adr/0008).
export function appOriginFrom(config: {
  APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}): string {
  if (config.APP_URL) return new URL(config.APP_URL).origin;
  if (config.VERCEL_PROJECT_PRODUCTION_URL) {
    return new URL(`https://${config.VERCEL_PROJECT_PRODUCTION_URL}`).origin;
  }
  return "http://localhost:3000";
}

export const APP_ORIGIN = appOriginFrom(env);

// The MCP server's URL, exactly as clients connect to it and as tokens name it in `aud`. No
// trailing slash or query (Clerk compares it as a string).
export const MCP_URL = `${APP_ORIGIN}/mcp`;

// Where the OAuth protected-resource metadata for MCP_URL lives (RFC 9728: the resource's
// path appended to /.well-known/oauth-protected-resource).
export const MCP_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
