import { SidebarMenu } from "@/components/ui/sidebar";
import { listRecentChats } from "@/features/chat/queries";
import { requireUserId } from "@/server/auth";

import { RecentChatItem } from "./recent-chat-item";

export async function RecentChats() {
  const userId = await requireUserId();
  const chats = await listRecentChats(userId);

  if (chats.length === 0) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet</p>;
  }

  return (
    <SidebarMenu>
      {chats.map((chat) => (
        <RecentChatItem key={chat.id} chat={chat} />
      ))}
    </SidebarMenu>
  );
}
