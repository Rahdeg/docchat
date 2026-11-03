import { ListTodoIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer } from "@/components/page-header";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { TasksView } from "@/features/tasks/components/tasks-view";
import { listTasks } from "@/features/tasks/queries";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Tasks · DocChat" };

export default function TasksPage() {
  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Tasks</h1>
        <Suspense fallback={<TasksSkeleton />}>
          <Tasks />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function Tasks() {
  const userId = await requireUserId();
  const tasks = await listTasks(userId);
  return (
    <>
      <TasksView tasks={tasks} />
      {tasks.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListTodoIcon />
            </EmptyMedia>
            <EmptyTitle>No tasks yet</EmptyTitle>
            <EmptyDescription>
              Add one above, or ask in a chat, like &ldquo;Turn my tenancy agreement into a
              checklist&rdquo;. DocChat suggests tasks from your documents, and adds them once you
              say yes.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </>
  );
}

function TasksSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-72" />
      <Skeleton className="h-14 w-full rounded-[10px]" />
      <div className="flex flex-col gap-3 rounded-[10px] border bg-card p-4">
        {["w-3/5", "w-1/2", "w-2/3"].map((width) => (
          <Skeleton key={width} className={`h-10 ${width}`} />
        ))}
      </div>
    </div>
  );
}
