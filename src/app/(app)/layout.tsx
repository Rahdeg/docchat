import type { Metadata } from "next";
import Link from "next/link";

import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/lib/routes";

// Signed-in pages are private: never in search results (robots.ts also disallows them).
export const metadata: Metadata = { robots: { index: false, follow: false } };

// No auth check here: layouts don't re-render on client navigation. Every page and every
// streamed sidebar section calls requireUserId() itself.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthProvider>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-12 items-center gap-2 border-b bg-sidebar px-3 md:hidden">
              <SidebarTrigger />
              <Link href={routes.library}>
                <Logo />
              </Link>
            </header>
            {children}
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
      {/* No theme provider yet, so pin it: "system" would follow the OS into dark toasts. */}
      <Toaster position="bottom-right" theme="light" />
    </AuthProvider>
  );
}
