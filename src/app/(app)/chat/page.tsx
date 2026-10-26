import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { FindPassages } from "@/features/chat/components/find-passages";
import { listReadyDocuments } from "@/features/documents/queries";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Chat · DocChat" };

// TODO(chat, PR 6): stream answers with citations; this "find passages" mode is temporary.
export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<ChatSkeleton />}>
        <Chat />
      </Suspense>
    </div>
  );
}

async function Chat() {
  const userId = await requireUserId();
  const documents = await listReadyDocuments(userId);
  return <FindPassages documents={documents} />;
}

// Prerendered, so fixed sizes only.
function ChatSkeleton() {
  return (
    <>
      <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col items-center justify-center gap-3 px-4 py-10">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-5 w-80" />
      </div>
      <div className="mx-auto w-full max-w-[800px] px-4 pb-4 md:px-8 md:pb-6">
        <Skeleton className="h-[118px] w-full rounded-[14px]" />
      </div>
    </>
  );
}
