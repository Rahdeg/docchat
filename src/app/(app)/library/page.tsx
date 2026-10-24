import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { LibraryView } from "@/features/documents/components/library-view";
import { listDocuments } from "@/features/documents/queries";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Library · DocChat" };

// Server Actions on this page (registerDocument, retryDocument) index documents in after(),
// which runs inside the same function and stops at this limit. 300 s is the most Vercel allows
// on every plan with Fluid compute, and stays under the 10 minutes after which the Library
// shows a document as stuck (STUCK_AFTER_MINUTES).
export const maxDuration = 300;

export default function LibraryPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <Library />
    </Suspense>
  );
}

async function Library() {
  const userId = await requireUserId();
  const documents = await listDocuments(userId);
  return <LibraryView userId={userId} documents={documents} />;
}

// Prerendered, so fixed sizes only (no random widths or current time).
function LibrarySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-7 px-4 pt-5 pb-28 md:px-12 md:pt-10 md:pb-14">
      <div className="flex flex-col gap-1 md:gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-[28px]">Library</h1>
        <Skeleton className="h-5 w-64" />
      </div>
      <Skeleton className="h-8 w-80" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-7 gap-y-9">
        {["a", "b", "c", "d"].map((key) => (
          <div key={key} className="flex flex-col gap-3.5">
            <Skeleton className="h-[252px] w-[calc(100%-10px)] rounded-[3px]" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
