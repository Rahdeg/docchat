export const routes = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  library: "/library",
  chat: "/chat",
  tasks: "/tasks",
} as const;

// Pages a signed-out visitor may open. The auth pages are catch-all routes (Clerk renders
// steps like /sign-in/factor-one), so their sub-paths are public too.
const publicPrefixes = [routes.signIn, routes.signUp];

export function isPublicPath(pathname: string): boolean {
  if (pathname === routes.home) return true;
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
