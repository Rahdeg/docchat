"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  creatorLabels,
  dueLabel,
  TASK_TITLE_MAX_CHARS,
  type CalendarDay,
  type TaskItem,
} from "../task-rules";
import { DueDatePicker } from "./due-date-picker";
import { TaskSourceLink } from "./task-source";

export type TaskRowHandlers = {
  onToggle: (task: TaskItem, done: boolean) => void;
  onRename: (task: TaskItem, title: string) => void;
  onDueDate: (task: TaskItem, dueDate: CalendarDay | null) => void;
  onDelete: (task: TaskItem) => void;
};

type TaskRowProps = TaskRowHandlers & { task: TaskItem; today: CalendarDay };

// One task: checkbox, title (editable in place), where it came from, the due chip and a menu.
export function TaskRow({ task, today, onToggle, onRename, onDueDate, onDelete }: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const overdue = !task.done && task.dueDate !== null && task.dueDate < today;

  return (
    <li className="flex items-start gap-3.5 px-4 py-3.5 not-last:border-b not-last:border-border/60">
      <Checkbox
        checked={task.done}
        onCheckedChange={(checked) => onToggle(task, checked)}
        aria-label={`${task.done ? "Mark not done" : "Mark done"}: ${task.title}`}
        className="mt-px size-5 rounded-[5px]"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <TitleEditor
            title={task.title}
            onDone={(title) => {
              setEditing(false);
              if (title !== null && title !== task.title) onRename(task, title);
            }}
          />
        ) : (
          <span
            className={cn(
              "text-[15px] font-medium break-words",
              task.done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </span>
        )}
        {task.source ? (
          <TaskSourceLink source={task.source} title={task.title} />
        ) : (
          <span className="text-[13px] text-muted-foreground">{creatorLabels[task.createdBy]}</span>
        )}
        {task.dueNote && !task.dueDate ? (
          <span className="text-[13px] text-muted-foreground">Due {task.dueNote}</span>
        ) : null}
      </div>

      <DueDatePicker
        value={task.dueDate}
        onChange={(day) => onDueDate(task, day)}
        open={dateOpen}
        onOpenChange={setDateOpen}
        trigger={
          task.dueDate ? (
            <button
              type="button"
              aria-label={`Change the due date of ${task.title}`}
              className={cn(
                "shrink-0 rounded-[3px_6px_4px_7px] px-2 py-[3px] text-xs font-medium",
                overdue
                  ? "bg-status-problem text-status-problem-foreground"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {dueLabel(task.dueDate, today, task.done)}
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Add a due date to ${task.title}`}
              className="h-[26px] shrink-0 rounded-md border border-dashed border-border-strong px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Add date
            </button>
          )
        }
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More actions for ${task.title}`}
              className="-my-1 shrink-0"
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setEditing(true)}>Edit</DropdownMenuItem>
            {/* After the menu has closed, so the calendar isn't closed with it. */}
            <DropdownMenuItem onClick={() => setTimeout(() => setDateOpen(true))}>
              Change date
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(task)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// Enter or leaving the field saves; Escape cancels (null).
export function TitleEditor({
  title,
  onDone,
  label = "Task title",
}: {
  title: string;
  onDone: (title: string | null) => void;
  label?: string;
}) {
  const [value, setValue] = useState(title);

  function finish() {
    const trimmed = value.trim();
    onDone(trimmed ? trimmed : null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      finish();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onDone(null);
    }
  }

  return (
    <Input
      autoFocus
      aria-label={label}
      value={value}
      maxLength={TASK_TITLE_MAX_CHARS}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={finish}
      className="h-8 text-[15px] font-medium paper"
    />
  );
}
