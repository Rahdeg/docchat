import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ChatView } from "@/features/chat/components/chat-view";
import { getChat, listMessages } from "@/features/chat/queries";
import { listReadyDocuments } from "@/features/documents/queries";
import { requireUserId } from "@/server/auth";

import { ChatSkeleton } from "../chat-skeleton";

export const metadata: Metadata = { title: "Chat · DocChat" };

export default function ChatPage({ params }: PageProps<"/chat/[chatId]">) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <Chat params={params} />
    </Suspense>
  );
}

async function Chat({ params }: Pick<PageProps<"/chat/[chatId]">, "params">) {
  const userId = await requireUserId();
  const { chatId } = await params;
  if (!z.uuid().safeParse(chatId).success) notFound();

  // An id with no chat yet is a new chat (see ../page.tsx). Someone else's chat looks the same:
  // empty, and posting to it fails.
  const [chat, documents] = await Promise.all([
    getChat(userId, chatId),
    listReadyDocuments(userId),
  ]);
  const messages = chat ? await listMessages(userId, chatId) : [];

  return (
    <ChatView
      key={chatId}
      chatId={chatId}
      title={chat?.title ?? null}
      initialMessages={messages}
      documents={documents}
    />
  );
}
