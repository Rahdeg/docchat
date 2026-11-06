import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";

// Clerk's authorization server metadata (RFC 8414), for older MCP clients that look for it on
// the resource's own origin instead of following the protected-resource metadata. Public, with
// CORS for browser clients.
const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
