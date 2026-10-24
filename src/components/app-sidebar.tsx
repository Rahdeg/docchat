import { UserButton } from "@clerk/nextjs";
import { LibraryIcon, ListTodoIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/logo";
import { NavMain } from "@/components/nav-main";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenuBadge,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { countChats } from "@/features/chat/queries";
import { RecentChats } from "@/features/chat/components/recent-chats";
import { DocumentsUsage } from "@/features/documents/components/documents-usage";
import { countDocuments } from "@/features/documents/queries";
import { countOpenTasks } from "@/features/tasks/queries";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { requireUserId } from "@/server/auth";

// The sidebar frame is static. Counts and recent chats read the session, so each streams in
// behind its own <Suspense>.
export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="gap-3 p-3">
        <Link href={routes.library} className="w-fit px-2 py-1">
          <Logo />
        </Link>
        <Button nativeButton={false} render={<Link href={routes.chat} />}>
          <PlusIcon data-icon="inline-start" />
          New chat
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMain
              items={[
                {
                  href: routes.chat,
                  label: "Chat",
                  icon: <MessageSquareIcon />,
                  badge: <NavCount count={countChats} />,
                },
                {
                  href: routes.library,
                  label: "Library",
                  icon: <LibraryIcon />,
                  badge: <NavCount count={countDocuments} />,
                },
                {
                  href: routes.tasks,
                  label: "Tasks",
                  icon: <ListTodoIcon />,
                  badge: <NavCount count={countOpenTasks} />,
                },
              ]}
            />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <Suspense fallback={<RecentChatsSkeleton />}>
              <RecentChats />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 border-t p-3">
        <Suspense fallback={<Skeleton className="h-[58px] rounded-[10px]" />}>
          <DocumentsUsage />
        </Suspense>
        <UserButton showName />
      </SidebarFooter>
    </Sidebar>
  );
}

// Not SidebarMenuSkeleton: its random widths (Math.random) can't be prerendered.
function RecentChatsSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      {["w-4/5", "w-3/5", "w-2/3"].map((width) => (
        <Skeleton key={width} className={cn("h-5", width)} />
      ))}
    </div>
  );
}

function NavCount({ count }: { count: (userId: string) => Promise<number> }) {
  return (
    <Suspense fallback={null}>
      <NavCountValue count={count} />
    </Suspense>
  );
}

async function NavCountValue({ count }: { count: (userId: string) => Promise<number> }) {
  const userId = await requireUserId();
  return <SidebarMenuBadge>{await count(userId)}</SidebarMenuBadge>;
}
