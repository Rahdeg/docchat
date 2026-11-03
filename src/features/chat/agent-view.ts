// The agent's answer as the chat shows it: the steps list, the approval card's state and its
// labels, and what "Add N tasks" sends. Pure, so the browser and tests share it.
import { displayName } from "@/features/documents/upload-rules";
import { plural } from "@/lib/format";
import { shortDay, type CalendarDay } from "@/features/tasks/task-rules";

import type { ApprovedTask, CheckedTask, Proposal } from "./agent-parts";
import { passagesOf, proposalOf, type ChatUIMessage, type ProposeTasksPart } from "./message";

// waiting: the card asks; sending: "Add" or "Cancel" was clicked and the reply is on its way;
// added / cancelled: answered.
export type ProposalState = "checking" | "waiting" | "sending" | "added" | "cancelled";

export function proposalState(part: ProposeTasksPart | null, proposal: Proposal | null) {
  if (!part) return "checking" as const;
  switch (part.state) {
    case "approval-requested":
      return proposal ? ("waiting" as const) : ("checking" as const);
    case "approval-responded":
      return "sending" as const;
    case "output-available":
      return "added" as const;
    case "output-denied":
      return "cancelled" as const;
    default:
      return "checking" as const;
  }
}

// An answer the agent worked on: it searched or proposed.
export function isAgentAnswer(message: Pick<ChatUIMessage, "parts">): boolean {
  return message.parts.some(
    (p) => p.type === "tool-proposeTasks" || p.type === "tool-searchDocuments",
  );
}

export type Step = { label: string; status: "done" | "active" | "waiting" };

// "Read 9 passages from Tenancy agreement", "Picked out 6 things to do", "Waiting for you to
// check them".
export function agentSteps(message: Pick<ChatUIMessage, "parts">, streaming: boolean): Step[] {
  const passages = passagesOf(message)?.passages ?? [];
  const found = proposalOf(message);
  const state = proposalState(found?.part ?? null, found?.proposal ?? null);
  const steps: Step[] = [];

  if (passages.length > 0) {
    const names = [...new Set(passages.map((p) => p.name))];
    const from = names.length === 1 ? displayName(names[0]!) : plural(names.length, "document");
    steps.push({
      label: `Read ${plural(passages.length, "passage")} from ${from}`,
      status: "done",
    });
  }
  if (!found?.proposal) {
    if (streaming) steps.push({ label: "Looking for things to do…", status: "active" });
    return steps;
  }

  steps.push({
    label: `Picked out ${plural(found.proposal.tasks.length, "thing")} to do`,
    status: "done",
  });
  if (state === "waiting")
    steps.push({ label: "Waiting for you to check them", status: "waiting" });
  else if (state === "sending") steps.push({ label: "Saving your choice…", status: "active" });
  else if (state === "added") {
    const added = found.part?.state === "output-available" ? found.part.output.added : 0;
    steps.push({ label: `Added ${plural(added, "task")} to your list`, status: "done" });
  } else if (state === "cancelled") {
    steps.push({ label: "Cancelled: nothing was added", status: "done" });
  }
  return steps;
}

// One task on the card as the user has left it.
export type TaskChoice = { included: boolean; title: string; dueDate: CalendarDay | null };

// Required tasks start ticked; ones the document only advises start unticked.
export function initialChoices(proposal: Proposal): TaskChoice[] {
  return proposal.tasks.map((t) => ({ included: !t.optional, title: t.title, dueDate: t.dueDate }));
}

// What "Add N tasks" sends: the ticked tasks by index, with their titles and dates.
export function approvedTasks(choices: readonly TaskChoice[]): ApprovedTask[] {
  return choices.flatMap((choice, index) =>
    choice.included && choice.title.trim()
      ? [{ index, title: choice.title.trim(), dueDate: choice.dueDate }]
      : [],
  );
}

// The date button: "Before 1 Nov", "By 8 Nov" or "1 Nov", from how the due note words it.
export function dueButtonLabel(
  dueDate: CalendarDay,
  dueNote: string | null,
  today: CalendarDay,
): string {
  const day = shortDay(dueDate, today);
  if (dueNote && /\bbefore\b/i.test(dueNote)) return `Before ${day}`;
  if (dueNote && /\b(within|by|no later than|not later than)\b/i.test(dueNote)) return `By ${day}`;
  return day;
}

// "Clause 4.2, within 7 days of moving in" under a task's title.
export function taskMeta(task: CheckedTask): string {
  const label = task.label ? task.label.charAt(0).toUpperCase() + task.label.slice(1) : null;
  const parts = [label, task.dueNote, task.optional ? "advised, not required" : null];
  return parts.filter(Boolean).join(", ");
}

// The fixed line after "Add": its "Tasks page" becomes a link.
export const TASKS_PAGE_LINK_TEXT = "Tasks page";

// The answer's text before the proposal (the model's), and after it (the fixed line saying what
// was added). An answer without a proposal is all "before".
export function textAround(message: Pick<ChatUIMessage, "parts">): {
  before: string;
  after: string;
} {
  const at = message.parts.findIndex((p) => p.type === "tool-proposeTasks");
  let before = "";
  let after = "";
  message.parts.forEach((part, index) => {
    if (part.type !== "text") return;
    if (at === -1 || index < at) before += part.text;
    else after += part.text;
  });
  return { before, after };
}
