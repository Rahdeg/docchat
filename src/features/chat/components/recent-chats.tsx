import { MessageSquareIcon } from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { listRecentChats } from "@/features/chat/queries";
import { requireUserId } from "@/server/auth";

export async function RecentChats() {
  const userId = await requireUserId();
  const chats = await listRecentChats(userId);

  if (chats.length === 0) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet</p>;
  }

  // TODO(chat): link each item to /chat/[id] once conversations open.
  return (
    <SidebarMenu>
      {chats.map((chat) => (
        <SidebarMenuItem key={chat.id}>
          <SidebarMenuButton size="sm" disabled tooltip="Opening chats is coming soon">
            <MessageSquareIcon />
            <span>{chat.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
