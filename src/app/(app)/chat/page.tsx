import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { chatUrl } from "@/lib/routes";
import { requireUserId } from "@/server/auth";

import { ChatSkeleton } from "./chat-skeleton";

export const metadata: Metadata = { title: "Chat" };

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
  await requireUserId();
  const { documentId } = await searchParams;
  // auth() isn't enough to keep a random value out of prerendering: dev validation and runtime
  // prefetches render with the request's data but still forbid crypto.randomUUID(). connection()
  // waits for a real navigation (io() would let a prefetch, e.g. the sidebar's "New chat" link,
  // capture one id that every click then reuses).
  await connection();
  const url = chatUrl(crypto.randomUUID());
  redirect(
    typeof documentId === "string" ? `${url}?documentId=${encodeURIComponent(documentId)}` : url,
  );
}
