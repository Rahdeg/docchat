import Link from "next/link";

import { AppSidebar } from "@/components/app-sidebar";
import { Logo } from "@/components/logo";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { routes } from "@/lib/routes";

// No auth check here: layouts don't re-render on client navigation. Every page and every
// streamed sidebar section calls requireUserId() itself.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
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
  );
}
