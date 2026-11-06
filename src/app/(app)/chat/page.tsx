import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { chatUrl } from "@/lib/routes";
import { requireUserId } from "@/server/auth";

import { ChatSkeleton } from "./chat-skeleton";

export const metadata: Metadata = { title: "Chat · DocChat" };

// "New chat": picks the new chat's id and opens it. The chat is stored with its first
// question, so the page that answers it is the one it stays on (docs/adr/0006). "Ask about
// this" adds ?documentId=…, passed on for the chat page to check and then drop.
export default function NewChatPage({ searchParams }: PageProps<"/chat">) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <NewChat searchParams={searchParams} />
    </Suspense>
  );
}

async function NewChat({ searchParams }: Pick<PageProps<"/chat">, "searchParams">): Promise<never> {
  // Signed in, and past the prerender: a random id needs a request.
  await requireUserId();
  const { documentId } = await searchParams;
  const url = chatUrl(crypto.randomUUID());
  redirect(
    typeof documentId === "string" ? `${url}?documentId=${encodeURIComponent(documentId)}` : url,
  );
}
