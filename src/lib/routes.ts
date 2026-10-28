export const routes = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  library: "/library",
  chat: "/chat",
  tasks: "/tasks",
} as const;

// One chat. A new chat's id is chosen before its first question; the chat is stored then.
export function chatUrl(chatId: string): string {
  return `${routes.chat}/${chatId}`;
}

// A document's original file, served to its owner only (src/app/api/documents/[id]/file).
// `page` adds #page=N, which browsers' PDF viewers open at; pass it only for PDFs.
export function documentFileUrl(documentId: string, page?: number | null): string {
  const url = `/api/documents/${documentId}/file`;
  return page ? `${url}#page=${page}` : url;
}

// Pages a signed-out visitor may open. The auth pages are catch-all routes (Clerk renders
// steps like /sign-in/factor-one), so their sub-paths are public too.
const publicPrefixes = [routes.signIn, routes.signUp];

export function isPublicPath(pathname: string): boolean {
  if (pathname === routes.home) return true;
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
