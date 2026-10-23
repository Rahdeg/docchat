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

    // Route handlers answer 401 themselves instead of redirecting to a page.
    if (!isAuthenticated && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
      return redirectToSignIn({ returnBackUrl: req.url });
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
