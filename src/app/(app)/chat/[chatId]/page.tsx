import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ChatView } from "@/features/chat/components/chat-view";
import { getChat, listMessages } from "@/features/chat/queries";
import { startingScope } from "@/features/chat/scope";
import { getDocument, listReadyDocuments } from "@/features/documents/queries";
import { requireUserId } from "@/server/auth";

import { ChatSkeleton } from "../chat-skeleton";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage({ params, searchParams }: PageProps<"/chat/[chatId]">) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <Chat params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Chat({ params, searchParams }: PageProps<"/chat/[chatId]">) {
  const userId = await requireUserId();
  const [{ chatId }, { documentId }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(chatId).success) notFound();

  // An id with no chat yet is a new chat (see ../page.tsx). Someone else's chat looks the same:
  // empty, and posting to it fails.
  const [chat, documents] = await Promise.all([
    getChat(userId, chatId),
    listReadyDocuments(userId),
  ]);
  const messages = chat ? await listMessages(userId, chatId) : [];

  // "Ask about this" (?documentId=…) only starts a new chat; a saved chat keeps its own scope.
  const linkedId = typeof documentId === "string" ? documentId : null;
  const linked =
    !chat && linkedId && z.uuid().safeParse(linkedId).success
      ? await getDocument(userId, linkedId)
      : null;
  const scope = startingScope({
    ready: documents,
    saved: chat?.documentIds ?? null,
    linkedId,
    linkedExists: linked !== null,
  });

  return (
    <ChatView
      key={chatId}
      chatId={chatId}
      title={chat?.title ?? null}
      initialMessages={messages}
      documents={documents}
      initialDocumentIds={scope.documentIds}
      notice={scope.notice}
      fromLink={linkedId !== null}
    />
  );
}
