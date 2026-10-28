import { Skeleton } from "@/components/ui/skeleton";

// Prerendered, so fixed sizes only.
export function ChatSkeleton() {
  return (
    <div className="flex flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[53px] items-center border-b px-4 md:h-[57px] md:px-8">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center gap-3 px-4 py-10">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-5 w-80" />
        </div>
        <div className="mx-auto w-full max-w-[720px] px-4 pb-4 md:px-8 md:pb-6">
          <Skeleton className="h-[118px] w-full rounded-[14px]" />
        </div>
      </div>
      <div className="hidden w-[380px] shrink-0 border-l bg-panel lg:block" />
    </div>
  );
}
