import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

import { MCP_URL } from "@/lib/app-url";
import { SUPPORTED_SCOPES } from "@/server/mcp/auth";

// OAuth protected-resource metadata for /mcp (RFC 9728): names Clerk as the authorization
// server and the exact URL tokens must be issued for. Public, with CORS for browser clients.
const handler = protectedResourceHandlerClerk({
  resource: MCP_URL,
  scopes_supported: SUPPORTED_SCOPES,
  resource_name: "DocChat",
});
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
