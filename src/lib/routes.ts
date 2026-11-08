export const routes = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  library: "/library",
  chat: "/chat",
  tasks: "/tasks",
  settings: "/settings",
  mcp: "/mcp",
  howWeTest: "/how-we-test",
} as const;

// One chat. A new chat's id is chosen before its first question; the chat is stored then.
export function chatUrl(chatId: string): string {
  return `${routes.chat}/${chatId}`;
}

// "Ask about this" on a document: a new chat that starts scoped to it. The chat page reads the
// id once, then drops it from the URL (src/features/chat/scope.ts).
export function askAboutUrl(documentId: string): string {
  return `${routes.chat}?documentId=${encodeURIComponent(documentId)}`;
}

// A document's original file, served to its owner only (src/app/api/documents/[id]/file).
// `page` adds #page=N, which browsers' PDF viewers open at; pass it only for PDFs.
export function documentFileUrl(documentId: string, page?: number | null): string {
  const url = `/api/documents/${documentId}/file`;
  return page ? `${url}#page=${page}` : url;
}

// Pages a signed-out visitor may open. The auth pages are catch-all routes (Clerk renders
// steps like /sign-in/factor-one), so their sub-paths are public too. The MCP server and its
// OAuth metadata are public to the proxy: /mcp checks its own bearer token (withMcpAuth), and
// clients read /.well-known/* before they have one (docs/adr/0008). Crawlers and link previews
// read robots.txt, the sitemap and the generated images signed out: /opengraph-image and
// /apple-icon have no file extension, so the proxy's matcher doesn't skip them as it does
// /icon.svg.
const publicPrefixes = [
  routes.signIn,
  routes.signUp,
  routes.mcp,
  routes.howWeTest,
  "/.well-known",
  "/opengraph-image",
  "/apple-icon",
];
const publicFiles = new Set(["/robots.txt", "/sitemap.xml"]);

// Public pages that belong in the sitemap (src/app/sitemap.ts).
export const indexablePaths = [routes.home, routes.howWeTest, routes.signUp, routes.signIn];

export function isPublicPath(pathname: string): boolean {
  if (pathname === routes.home || publicFiles.has(pathname)) return true;
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
