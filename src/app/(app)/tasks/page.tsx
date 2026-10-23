import { ListTodoIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/page-header";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { listTasks } from "@/features/tasks/queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Tasks · DocChat" };

export default function TasksPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        description="Action items from your documents and chats. Editing them is coming soon."
      />
      <Suspense fallback={<TasksSkeleton />}>
        <Tasks />
      </Suspense>
    </PageContainer>
  );
}

async function Tasks() {
  const userId = await requireUserId();
  const tasks = await listTasks(userId);

  if (tasks.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTodoIcon />
          </EmptyMedia>
          <EmptyTitle>No tasks yet</EmptyTitle>
          <EmptyDescription>
            Tasks show up here when DocChat finds something you need to do in your documents.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // TODO(tasks): make the checkboxes toggle via an authedAction.
  return (
    <ItemGroup className="gap-0 rounded-xl border bg-card">
      {tasks.map((task) => (
        <Item key={task.id} className="rounded-none border-0 not-last:border-b">
          <ItemMedia>
            <Checkbox checked={task.done} disabled aria-label={task.title} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className={cn(task.done && "text-muted-foreground line-through")}>
              {task.title}
            </ItemTitle>
            {task.dueDate ? (
              <ItemDescription>Due {formatDate(task.dueDate)}</ItemDescription>
            ) : null}
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

function TasksSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
