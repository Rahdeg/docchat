import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthProvider } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { SkipLink } from "@/components/skip-link";
import { Skeleton } from "@/components/ui/skeleton";
import { site } from "@/content/site";
import { DeskComposition } from "@/features/public/components/compositions";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  description: "Sign in to DocChat to ask questions about your documents and check every answer.",
};

// docs/design/public/sign-in.html: the grey desk with the headline and a sheet-and-answer
// picture on the left (from 900px), Clerk's form on white paper on the right. The page's h1 is
// Clerk's own title ("Sign in to DocChat", set in AuthProvider's localization), so the desk
// headline is a paragraph: on phones, where the desk is hidden, the h1 is still there.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthProvider>
      <div data-site className="flex min-h-svh flex-1 text-[15px] leading-[1.55] text-foreground">
        <SkipLink />
        <section
          aria-label="About DocChat"
          className="hidden flex-[1_1_560px] flex-col gap-10 overflow-hidden px-14 py-10 min-[900px]:flex"
        >
          <Link href={routes.home} className="self-start rounded-md">
            <Logo size="lg" />
          </Link>
          <div className="mt-auto flex max-w-[520px] flex-col gap-7">
            <p className="font-serif text-[46px] leading-[1.08] font-medium tracking-[-0.02em]">
              {site.tagline}
            </p>
            <DeskComposition />
          </div>
          <p className="text-[13px] text-muted-foreground">
            Your files are private and only reachable through your account.
          </p>
        </section>

        <main
          id="main"
          tabIndex={-1}
          className="flex flex-[1_1_480px] flex-col items-center gap-8 bg-card px-6 py-6 outline-none paper min-[900px]:justify-center min-[900px]:border-l min-[900px]:border-border min-[900px]:py-12"
        >
          <Link href={routes.home} className="self-start rounded-md min-[900px]:hidden">
            <Logo size="lg" />
          </Link>
          <div className="flex w-full max-w-[380px] flex-1 flex-col justify-center min-[900px]:flex-none">
            {/* Clerk's components read the URL (usePathname), which Cache Components streams in. */}
            <Suspense fallback={<Skeleton className="h-[460px] w-full rounded-lg" />}>
              {children}
            </Suspense>
          </div>
        </main>
      </div>
    </AuthProvider>
  );
}
