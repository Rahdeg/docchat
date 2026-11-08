import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";

import { ZodBrowserConfig } from "@/components/zod-browser-config";
import { routes } from "@/lib/routes";

// Clerk's provider, only around the pages that need Clerk in the browser: the signed-in app and
// the sign-in and sign-up pages. The public pages (/, /how-we-test) and the error pages render
// without it, so they ship no Clerk JavaScript. Server-side auth doesn't need the provider:
// the proxy, auth(), the MCP token check and the webhook all read the request.
//
// Zod's browser config rides along: only these pages parse anything with Zod in the browser.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{ theme: shadcn }}
      localization={{
        // The design's wording (docs/design/public/sign-in.html). Clerk shortens social buttons
        // to the provider's name when several share a row; ours are one per row.
        socialButtonsBlockButton: "Continue with {{provider|titleize}}",
        socialButtonsBlockButtonManyInView: "Continue with {{provider|titleize}}",
        signIn: {
          start: {
            title: "Sign in to DocChat",
            subtitle: "Welcome back. Your documents are where you left them.",
            actionText: "New to DocChat?",
            actionLink: "Create an account",
          },
        },
        signUp: {
          start: {
            title: "Create your DocChat account",
            subtitle: "Upload a document and ask your first question in under a minute.",
            actionText: "Already have an account?",
            actionLink: "Sign in",
          },
        },
      }}
      signInUrl={routes.signIn}
      signUpUrl={routes.signUp}
      signInFallbackRedirectUrl={routes.library}
      signUpFallbackRedirectUrl={routes.library}
      afterSignOutUrl={routes.home}
    >
      <ZodBrowserConfig />
      {children}
    </ClerkProvider>
  );
}
