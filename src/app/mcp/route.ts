import { env } from "@/lib/env";
import { createAuthedMcpHandler } from "@/server/mcp/server";

// DocChat's MCP server (docs/adr/0008), Streamable HTTP. Public to the proxy (isPublicPath):
// every request must carry an OAuth access token Clerk issued for this URL, checked by
// withMcpAuth. mcp-handler 2 serves stateless requests only, so there's no SSE transport and
// no Redis.

// A tool call is at most a search and a few queries.
export const maxDuration = 30;

const authed = createAuthedMcpHandler();

async function handler(request: Request): Promise<Response> {
  if (!env.MCP_ENABLED) {
    return new Response("DocChat's MCP server is turned off.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return authed(request);
}

export { handler as DELETE, handler as GET, handler as POST };
