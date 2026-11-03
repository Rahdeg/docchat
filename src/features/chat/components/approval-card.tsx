"use client";

import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";

import { CitationChip } from "@/components/citation-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DueDatePicker } from "@/features/tasks/components/due-date-picker";
import { TitleEditor } from "@/features/tasks/components/task-row";
import { useToday } from "@/features/tasks/use-today";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ApprovedTask, CheckedTask, Proposal } from "../agent-parts";
import {
  approvedTasks,
  dueButtonLabel,
  initialChoices,
  taskMeta,
  type TaskChoice,
} from "../agent-view";

type ApprovalCardProps = {
  proposal: Proposal;
  // "Add" or "Cancel" was clicked and the reply is on its way.
  sending: boolean;
  // Only the last answer's proposal can be answered, and not while another reply streams.
  canAnswer: boolean;
  // The chip the Sources panel is showing, if it's one of this card's.
  active: number | null;
  onCite: (number: number) => void;
  onApprove: (tasks: ApprovedTask[]) => void;
  onCancel: () => void;
  // Phones: a sticky bottom bar, and unticked suggestions folded away.
  mobile: boolean;
};

// "Add N tasks to your list?": the proposed tasks, to untick, rename or re-date before adding.
// Nothing is saved until "Add N tasks" is clicked.
export function ApprovalCard({
  proposal,
  sending,
  canAnswer,
  active,
  onCite,
  onApprove,
  onCancel,
  mobile,
}: ApprovalCardProps) {
  const [choices, setChoices] = useState<TaskChoice[]>(() => initialChoices(proposal));
  const [showUnticked, setShowUnticked] = useState(false);
  const titleId = useId();
  const chosen = approvedTasks(choices);
  const disabled = sending || !canAnswer;

  const update = (index: number, change: Partial<TaskChoice>) =>
    setChoices((all) => all.map((c, i) => (i === index ? { ...c, ...change } : c)));

  // On phones, suggestions that start unticked fold under "N more suggestions".
  const folded = mobile && !showUnticked ? proposal.tasks.filter((t) => t.optional).length : 0;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-[4px] border-[1.5px] border-foreground bg-card shadow-[0_22px_40px_-24px_rgb(29_36_51/0.5)] paper"
    >
      <div className="flex flex-col gap-1 border-b px-4 pt-5 pb-3.5 md:px-[22px]">
        <h2 id={titleId} className="font-serif text-[22px] font-medium">
          Add {plural(chosen.length, "task")} to your list?
        </h2>
        <p className="text-muted-foreground">
          {mobile
            ? "Untick anything you don't need."
            : "Untick anything you don't need, or change a date. Nothing is saved until you add them."}
        </p>
      </div>

      <ul>
        {proposal.tasks.map((task, index) =>
          folded > 0 && task.optional ? null : (
            <ProposedTaskRow
              key={index}
              task={task}
              choice={choices[index]!}
              disabled={disabled}
              active={active === task.citation}
              onChange={(change) => update(index, change)}
              onCite={() => onCite(task.citation)}
            />
          ),
        )}
      </ul>

      {folded > 0 ? (
        <button
          type="button"
          className="flex items-center gap-1 px-4 py-3 text-[13px] text-secondary-text"
          onClick={() => setShowUnticked(true)}
        >
          {plural(folded, "more suggestion")} (unticked)
          <ChevronDownIcon aria-hidden className="size-3.5" />
        </button>
      ) : null}

      <div
        className={cn(
          "flex flex-wrap items-center gap-2.5 border-t bg-surface-sunken px-4 py-4 md:px-[22px]",
          mobile && "sticky bottom-0 z-10 bg-card pb-7",
        )}
      >
        {mobile ? (
          <>
            <Button
              variant="outline"
              className="h-12 rounded-[10px] px-[18px] text-[15px]"
              disabled={disabled}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              className="h-12 flex-1 rounded-[10px] text-[15px]"
              disabled={disabled || chosen.length === 0}
              onClick={() => onApprove(chosen)}
            >
              Add {plural(chosen.length, "task")}
            </Button>
          </>
        ) : (
          <>
            <Button
              className="h-10 rounded-lg px-[18px]"
              disabled={disabled || chosen.length === 0}
              onClick={() => onApprove(chosen)}
            >
              Add {plural(chosen.length, "task")}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-lg px-3.5"
              disabled={disabled}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <span className="ml-auto text-[13px] text-muted-foreground">
              {canAnswer
                ? "You can change them later on the Tasks page."
                : "Ask again to get suggestions you can add."}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

type RowProps = {
  task: CheckedTask;
  choice: TaskChoice;
  disabled: boolean;
  active: boolean;
  onChange: (change: Partial<TaskChoice>) => void;
  onCite: () => void;
};

function ProposedTaskRow({ task, choice, disabled, active, onChange, onCite }: RowProps) {
  const today = useToday();
  const [editing, setEditing] = useState(false);
  const meta = taskMeta(task);

  return (
    <li
      className={cn(
        "flex items-start gap-3.5 border-b border-border/60 px-4 py-3.5 md:px-[22px]",
        editing && "bg-surface-sunken/60",
        !choice.included && "text-muted-foreground",
      )}
    >
      <Checkbox
        checked={choice.included}
        onCheckedChange={(included) => onChange({ included })}
        disabled={disabled}
        aria-label={`Include: ${choice.title}`}
        className="mt-0.5 size-[18px]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <TitleEditor
            title={choice.title}
            onDone={(title) => {
              setEditing(false);
              if (title) onChange({ title });
            }}
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(true)}
            aria-label={`Edit the title: ${choice.title}`}
            className={cn(
              "self-start rounded-sm text-left text-[15px] font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:hover:no-underline",
              !choice.included && "line-through",
            )}
          >
            {choice.title}
          </button>
        )}
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <button
            type="button"
            onClick={onCite}
            aria-label={`Show source ${task.citation}`}
            aria-pressed={active}
            className="rounded-[5px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <CitationChip
              index={task.citation}
              featured={active}
              className="h-5 min-w-5 px-[5px] text-[11px]"
            />
          </button>
          {meta}
        </span>
      </div>
      <DueDatePicker
        value={choice.dueDate}
        onChange={(dueDate) => onChange({ dueDate })}
        trigger={
          choice.dueDate ? (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              className="h-8 shrink-0 rounded-[7px] px-2.5 text-[13px] font-normal"
              aria-label={`Change the due date of ${choice.title}`}
            >
              <CalendarIcon data-icon="inline-start" />
              {dueButtonLabel(choice.dueDate, task.dueNote, today)}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-8 shrink-0 rounded-[7px] border border-dashed border-border-strong px-2.5 text-[13px] font-normal text-muted-foreground"
              aria-label={`Add a due date to ${choice.title}`}
            >
              <CalendarIcon data-icon="inline-start" />
              Add date
            </Button>
          )
        }
      />
    </li>
  );
}
