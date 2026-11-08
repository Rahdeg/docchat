import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isPublicPath, routes } from "@/lib/routes";

// Optimistic redirects only. Clerk deprecated route matching in middleware: the real checks
// are requireUserId() in every (app) page and authedAction() in every Server Action.
export default clerkMiddleware(
  async (auth, req) => {
    const { pathname } = req.nextUrl;
    const { isAuthenticated, redirectToSignIn } = await auth();

    if (isAuthenticated && pathname === routes.home) {
      return NextResponse.redirect(new URL(routes.library, req.url));
    }

    // Route handlers answer 401 themselves instead of redirecting to a page. Clerk builds the
    // return URL from the Host and X-Forwarded-* headers; req.url would carry the server's bind
    // address in a standalone container (http://0.0.0.0:3000/...).
    if (!isAuthenticated && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
      return redirectToSignIn();
    }
  },
  { signInUrl: routes.signIn, signUpUrl: routes.signUp },
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
