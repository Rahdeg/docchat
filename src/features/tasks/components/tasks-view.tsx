"use client";

import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { useId, useOptimistic, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { displayName } from "@/features/documents/upload-rules";
import { cn } from "@/lib/utils";

import { createTask, deleteTask, restoreTask, toggleTask, updateTask } from "../actions";
import {
  byCompleted,
  groupTasks,
  groupTitles,
  shortDay,
  summaryLine,
  TASK_TITLE_MAX_CHARS,
  type CalendarDay,
  type TaskItem,
} from "../task-rules";
import { useToday } from "../use-today";
import { DueDatePicker } from "./due-date-picker";
import { TaskRow, type TaskRowHandlers } from "./task-row";

type Tab = "todo" | "done" | "all";

type Change =
  | { type: "add"; task: TaskItem }
  | { type: "update"; id: string; changes: Partial<Pick<TaskItem, "title" | "dueDate" | "done">> }
  | { type: "delete"; id: string };

function applyChange(tasks: TaskItem[], change: Change): TaskItem[] {
  switch (change.type) {
    case "add":
      return [...tasks, change.task];
    case "update":
      return tasks.map((t) => (t.id === change.id ? { ...t, ...change.changes } : t));
    case "delete":
      return tasks.filter((t) => t.id !== change.id);
  }
}

const ALL_DOCUMENTS = "all";

// The Tasks page below its heading: the summary, "Add a task", the tabs and the document
// filter, and the tasks grouped by when they're due. Changes show at once (useOptimistic); the
// server's refresh then replaces them with what was saved.
export function TasksView({ tasks: saved }: { tasks: TaskItem[] }) {
  const today = useToday();
  const [tasks, change] = useOptimistic(saved, applyChange);
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("todo");
  const [documentId, setDocumentId] = useState<string>(ALL_DOCUMENTS);

  function run(optimistic: Change, action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      change(optimistic);
      const result = await action();
      if (!result.ok) toast.error(result.error);
    });
  }

  const handlers: TaskRowHandlers = {
    onToggle: (task, done) =>
      run({ type: "update", id: task.id, changes: { done } }, () =>
        toggleTask({ id: task.id, done }),
      ),
    onRename: (task, title) =>
      run({ type: "update", id: task.id, changes: { title } }, () =>
        updateTask({ id: task.id, title }),
      ),
    onDueDate: (task, dueDate) =>
      run({ type: "update", id: task.id, changes: { dueDate } }, () =>
        updateTask({ id: task.id, dueDate }),
      ),
    onDelete: (task) =>
      run({ type: "delete", id: task.id }, async () => {
        const result = await deleteTask({ id: task.id });
        if (result.ok) {
          const snapshot = result.data;
          toast(`Deleted "${task.title}"`, {
            action: {
              label: "Undo",
              onClick: () => {
                void restoreTask(snapshot).then((restored) => {
                  if (!restored.ok) toast.error(restored.error);
                });
              },
            },
          });
        }
        return result;
      }),
  };

  function add(title: string, dueDate: CalendarDay | null) {
    const now = new Date().toISOString();
    run(
      {
        type: "add",
        task: {
          id: `new-${now}`,
          title,
          dueDate,
          dueNote: null,
          done: false,
          completedAt: null,
          createdAt: now,
          createdBy: "user",
          source: null,
        },
      },
      () => createTask({ title, dueDate }),
    );
  }

  // Documents that tasks came from, for the filter.
  const documents = [
    ...new Map(
      tasks.flatMap((t) =>
        t.source?.documentId && t.source.documentName
          ? [[t.source.documentId, displayName(t.source.documentName)] as const]
          : [],
      ),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const filter =
    documentId !== ALL_DOCUMENTS && documents.some(([id]) => id === documentId)
      ? documentId
      : ALL_DOCUMENTS;
  const shown =
    filter === ALL_DOCUMENTS ? tasks : tasks.filter((t) => t.source?.documentId === filter);

  const open = shown.filter((t) => !t.done);
  const done = shown.filter((t) => t.done).sort(byCompleted);

  return (
    <div className="flex flex-col gap-6">
      <p className="-mt-4 text-muted-foreground">
        {summaryLine(
          tasks.filter((t) => !t.done),
          today,
        )}{" "}
        Tasks DocChat found link back to the clause they came from.
      </p>

      <AddTaskForm today={today} onAdd={add} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList aria-label="Show tasks" className="h-[38px] bg-status-neutral paper">
            <TabsTrigger value="todo" className="px-3">
              To do <Count n={open.length} />
            </TabsTrigger>
            <TabsTrigger value="done" className="px-3">
              Done <Count n={done.length} />
            </TabsTrigger>
            <TabsTrigger value="all" className="px-3">
              All <Count n={shown.length} />
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {documents.length > 0 ? (
          <Select
            value={filter}
            onValueChange={(value) => setDocumentId(value ?? ALL_DOCUMENTS)}
            items={[
              { value: ALL_DOCUMENTS, label: "All documents" },
              ...documents.map(([value, label]) => ({ value, label })),
            ]}
          >
            <SelectTrigger aria-label="Filter by document" className="ml-auto h-9 bg-card paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL_DOCUMENTS}>All documents</SelectItem>
              {documents.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {tab !== "done" ? (
        open.length > 0 ? (
          groupTasks(open, today).map(({ group, tasks: grouped }) => (
            <TaskSection
              key={group}
              title={groupTitles[group]}
              tone={group === "overdue" ? "problem" : "default"}
              tasks={grouped}
              today={today}
              handlers={handlers}
            />
          ))
        ) : shown.length > 0 ? (
          <p className="text-sm text-muted-foreground">Everything&rsquo;s done.</p>
        ) : null
      ) : null}

      {tab === "todo" && done.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1.5 py-1 text-[13px] font-medium text-secondary-text">
            <span className="group-data-panel-open:hidden">Show {done.length} done</span>
            <span className="hidden group-data-panel-open:inline">Hide done</span>
            <ChevronDownIcon
              aria-hidden
              className="size-4 transition-transform group-data-panel-open:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <TaskList tasks={done} today={today} handlers={handlers} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {tab !== "todo" ? (
        done.length > 0 ? (
          <TaskSection title="Done" tasks={done} today={today} handlers={handlers} />
        ) : tab === "done" ? (
          <p className="text-sm text-muted-foreground">Nothing done yet.</p>
        ) : null
      ) : null}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tabular-nums">{n}</span>;
}

function TaskSection({
  title,
  tone = "default",
  tasks,
  today,
  handlers,
}: {
  title: string;
  tone?: "default" | "problem";
  tasks: TaskItem[];
  today: CalendarDay;
  handlers: TaskRowHandlers;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2
        id={id}
        className={cn(
          "text-[13px] font-semibold",
          tone === "problem" ? "text-status-problem-foreground" : "text-secondary-text",
        )}
      >
        {title}
      </h2>
      <TaskList tasks={tasks} today={today} handlers={handlers} />
    </section>
  );
}

function TaskList({
  tasks,
  today,
  handlers,
}: {
  tasks: TaskItem[];
  today: CalendarDay;
  handlers: TaskRowHandlers;
}) {
  return (
    <ul className="overflow-hidden rounded-[10px] border bg-card">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} today={today} {...handlers} />
      ))}
    </ul>
  );
}

function AddTaskForm({
  today,
  onAdd,
}: {
  today: CalendarDay;
  onAdd: (title: string, dueDate: CalendarDay | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<CalendarDay | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const inputId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed, dueDate);
    setTitle("");
    setDueDate(null);
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap gap-2 rounded-[10px] border border-border-strong/70 bg-card p-2 paper"
    >
      <label htmlFor={inputId} className="sr-only">
        New task
      </label>
      <input
        id={inputId}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a task"
        maxLength={TASK_TITLE_MAX_CHARS}
        className="h-10 min-w-0 flex-[1_1_240px] bg-transparent px-3 text-[15px] outline-none placeholder:text-muted-foreground"
      />
      <DueDatePicker
        value={dueDate}
        onChange={setDueDate}
        open={dateOpen}
        onOpenChange={setDateOpen}
        trigger={
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-10 rounded-lg px-3 text-[13px] font-normal",
              dueDate ? "border bg-secondary" : "border border-dashed border-border-strong",
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            {dueDate ? shortDay(dueDate, today) : "Due date"}
          </Button>
        }
      />
      <Button type="submit" className="h-10 rounded-lg px-4" disabled={!title.trim()}>
        Add
      </Button>
    </form>
  );
}
