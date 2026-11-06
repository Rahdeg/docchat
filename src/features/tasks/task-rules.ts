// Tasks as the Tasks page and the approval card show them: calendar-day helpers, grouping by
// due date, and the labels on due chips. Pure and shared by the client, the server and tests.
import { z } from "zod";

export const TASK_TITLE_MAX_CHARS = 200;
export const DUE_NOTE_MAX_CHARS = 200;
export const SOURCE_LABEL_MAX_CHARS = 60;

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the task a name.")
  .max(TASK_TITLE_MAX_CHARS, `Keep it under ${TASK_TITLE_MAX_CHARS} characters.`);

// A calendar day, "YYYY-MM-DD", that exists (no 31 February).
export const calendarDaySchema = z.iso.date();

export type CalendarDay = string;

// Who added a task: the user on the Tasks page, the agent from a chat (approved by the user),
// or the user's connected AI app over MCP (docs/adr/0008).
export const taskCreators = ["user", "agent", "mcp"] as const;
export type TaskCreator = (typeof taskCreators)[number];

// Shown under a task that has no source.
export const creatorLabels: Record<TaskCreator, string> = {
  user: "Added by you",
  agent: "From a chat",
  mcp: "From your AI app",
};

// A task with what the Tasks page needs to show it. Dates are strings so it can cross from a
// Server Component to the browser as is.
export type TaskItem = {
  id: string;
  title: string;
  dueDate: CalendarDay | null;
  dueNote: string | null;
  done: boolean;
  // ISO timestamps.
  completedAt: string | null;
  createdAt: string;
  createdBy: TaskCreator;
  source: TaskSource | null;
};

// Where an agent task came from. `passage` is null once the chunk is gone (the document was
// deleted or read again); the quote and label are kept.
export type TaskSource = {
  documentId: string | null;
  // Null when the document was deleted.
  documentName: string | null;
  mimeType: string | null;
  hasFile: boolean;
  page: number | null;
  passage: string | null;
  quote: string | null;
  // The quote's offsets in `passage`.
  start: number | null;
  end: number | null;
  label: string | null;
};

// Today in the viewer's time zone (call it in the browser), or in UTC on the server.
export function localDay(date: Date): CalendarDay {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, "0"))
    .join("-");
}

export function utcDay(date: Date): CalendarDay {
  return date.toISOString().slice(0, 10);
}

function toUtcDate(day: CalendarDay): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  const date = toUtcDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

// A calendar day as a local Date at midnight, for the date picker, and back.
export function dayToLocalDate(day: CalendarDay): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

// Days within this many of today (today included) are "This week".
const WEEK_DAYS = 7;

export const taskGroups = ["overdue", "week", "later", "none"] as const;
export type TaskGroup = (typeof taskGroups)[number];

export const groupTitles: Record<TaskGroup, string> = {
  overdue: "Overdue",
  week: "This week",
  later: "Later",
  none: "No due date",
};

export function groupOf(task: Pick<TaskItem, "dueDate">, today: CalendarDay): TaskGroup {
  if (!task.dueDate) return "none";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate < addDays(today, WEEK_DAYS)) return "week";
  return "later";
}

// Open tasks by group, each soonest first (then oldest first), skipping empty groups.
export function groupTasks(
  tasks: readonly TaskItem[],
  today: CalendarDay,
): { group: TaskGroup; tasks: TaskItem[] }[] {
  const byGroup = new Map<TaskGroup, TaskItem[]>(taskGroups.map((g) => [g, []]));
  for (const task of tasks) byGroup.get(groupOf(task, today))!.push(task);
  return taskGroups
    .map((group) => ({ group, tasks: byGroup.get(group)!.sort(byDueDate) }))
    .filter(({ tasks }) => tasks.length > 0);
}

export function byDueDate(a: TaskItem, b: TaskItem): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

// Done tasks, most recently done first.
export function byCompleted(a: TaskItem, b: TaskItem): number {
  return (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
}

const weekdayDayMonth = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// "1 Nov", or "1 Nov 2027" outside this year.
export function shortDay(day: CalendarDay, today: CalendarDay): string {
  const format = day.slice(0, 4) === today.slice(0, 4) ? dayMonth : dayMonthYear;
  return format.format(toUtcDate(day));
}

// The due chip: "Was due 1 Nov" when overdue, "Today", "Tomorrow", "Fri 7 Nov", or a date with
// its year outside this year.
export function dueLabel(day: CalendarDay, today: CalendarDay, done = false): string {
  if (!done && day < today) return `Was due ${shortDay(day, today)}`;
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day.slice(0, 4) !== today.slice(0, 4)) return dayMonthYear.format(toUtcDate(day));
  return weekdayDayMonth.format(toUtcDate(day)).replace(",", "");
}

// "6 to do, and 1 is overdue." The line under the Tasks heading.
export function summaryLine(open: readonly TaskItem[], today: CalendarDay): string {
  if (open.length === 0) return "Nothing to do.";
  const overdue = open.filter((t) => groupOf(t, today) === "overdue").length;
  const todo = `${open.length} to do`;
  if (overdue === 0) return `${todo}.`;
  return `${todo}, and ${overdue === open.length && overdue > 1 ? "all" : overdue} ${overdue === 1 ? "is" : "are"} overdue.`;
}
