import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { chatUrl } from "@/lib/routes";
import { requireUserId } from "@/server/auth";

import { ChatSkeleton } from "./chat-skeleton";

export const metadata: Metadata = { title: "Chat · DocChat" };

// "New chat": picks the new chat's id and opens it. The chat is stored with its first
// question, so the page that answers it is the one it stays on (docs/adr/0006).
export default function NewChatPage() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <NewChat />
    </Suspense>
  );
}

async function NewChat(): Promise<never> {
  // Signed in, and past the prerender: a random id needs a request.
  await requireUserId();
  redirect(chatUrl(crypto.randomUUID()));
}
