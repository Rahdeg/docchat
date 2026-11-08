import { SkipLink } from "@/components/skip-link";
import { SiteFooter } from "@/features/public/components/site-footer";
import { SiteHeader } from "@/features/public/components/site-header";

// Signed-out pages: the landing page and /how-we-test. Fully static and free of Clerk's
// JavaScript (no AuthProvider). Signed-in visitors to / are redirected to /library by the
// proxy before this renders, so the page itself never reads the session.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div data-site className="flex flex-1 flex-col overflow-x-clip leading-[1.6] text-foreground">
      <SkipLink />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
