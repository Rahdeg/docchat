import "server-only";

import {
  MAX_PROPOSED_TASKS,
  type CheckedTask,
  type ProposeTasksInput,
  type Proposal,
} from "@/features/chat/agent-parts";
import type { PassageData } from "@/features/chat/message";
import { matchQuote } from "./citations";

// Checks the agent's proposed tasks before the user sees them, and again before they're saved
// (docs/adr/0007):
//
// - the source number must be one of this run's passages (anything else is dropped);
// - the quote is looked for in that passage only (matchQuote, as for citations); when it isn't
//   found, the task points at the whole passage;
// - a due date is kept only if a passage of this run or a message of the user's states it, or
//   the due note gives a deadline relative to a date one of them states. Otherwise it's dropped
//   and the deadline stays in words. Never a date the model made up.

type CheckInput = {
  toolCallId: string;
  input: ProposeTasksInput;
  // This run's passages, numbered from 1.
  passages: readonly PassageData[];
  // What the user wrote in this chat, for dates they gave ("I move in on 1 November").
  userTexts: readonly string[];
  // The first chip number free after the answer's own citations.
  firstCitation: number;
};

export function checkProposal({
  toolCallId,
  input,
  passages,
  userTexts,
  firstCitation,
}: CheckInput): Proposal {
  const dateTexts = [...passages.map((p) => p.content), ...userTexts];
  const spans = new Map<string, number>();
  let rejected = 0;
  const tasks: CheckedTask[] = [];

  for (const proposed of input.tasks.slice(0, MAX_PROPOSED_TASKS)) {
    const passage = passages[proposed.source.number - 1];
    if (!passage) {
      rejected += 1;
      continue;
    }
    const match = matchQuote(passage.content, proposed.source.quote);
    const start = match?.start ?? 0;
    const end = match?.end ?? passage.content.length;

    const key = `${proposed.source.number}:${start}:${end}`;
    if (!spans.has(key)) spans.set(key, firstCitation + spans.size);

    const date = checkDueDate(proposed.dueDate, proposed.dueNote, dateTexts);
    tasks.push({
      title: oneLine(proposed.title),
      dueDate: date.dueDate,
      dueNote: date.dueNote,
      dateDropped: date.dropped,
      optional: proposed.optional ?? false,
      source: proposed.source.number,
      citation: spans.get(key)!,
      quote: proposed.source.quote,
      start,
      end,
      matched: match !== null,
      label: normalizeLabel(proposed.source.label) ?? clauseLabel(passage.content, start),
    });
  }

  return { toolCallId, tasks, rejected };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// "Clause 4.2" is stored as "clause 4.2"; the card capitalises it.
function normalizeLabel(label: string | undefined): string | null {
  const flat = label ? oneLine(label) : "";
  if (!flat) return null;
  return flat.replace(/^(clause|section|paragraph|part|schedule)\b/i, (word) => word.toLowerCase());
}

// The clause the quote sits in, from the nearest number like "13.2" before it (or at its
// start), as a fallback when the model gave no label.
export function clauseLabel(passage: string, start: number): string | null {
  const before = passage.slice(0, start + 8);
  const numbers = [...before.matchAll(/(?:^|[\s(])(\d{1,2}\.\d{1,2})(?=[\s)])/g)];
  const last = numbers.at(-1);
  return last ? `clause ${last[1]}` : null;
}

type DueDateCheck = { dueDate: string | null; dueNote: string | null; dropped: boolean };

// Keeps the model's date only when the texts back it up (see the top of the file).
export function checkDueDate(
  dueDate: string | undefined,
  dueNote: string | undefined,
  texts: readonly string[],
): DueDateCheck {
  const note = dueNote ? oneLine(dueNote) || null : null;
  if (!dueDate) return { dueDate: null, dueNote: note, dropped: false };
  if (!isCalendarDay(dueDate) || !dueDateIsGrounded(dueDate, note, texts)) {
    return { dueDate: null, dueNote: note, dropped: true };
  }
  return { dueDate, dueNote: note, dropped: false };
}

function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// "within 7 days", "two weeks", "one month", "10 working days": how far a deadline is from the
// date it counts from.
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  "twenty-one": 21,
  "twenty-eight": 28,
  thirty: 30,
};
const OFFSET = new RegExp(
  String.raw`\b(\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})\s+(working\s+|calendar\s+|clear\s+|business\s+)?(day|week|month)s?\b`,
  "gi",
);

// Ranges of days a due note allows between the stated date and the due date (either way).
export function noteOffsets(note: string): { min: number; max: number }[] {
  const ranges: { min: number; max: number }[] = [];
  for (const [, amount, kind, unit] of note.matchAll(OFFSET)) {
    const n = /^\d+$/.test(amount!) ? Number(amount) : NUMBER_WORDS[amount!.toLowerCase()]!;
    const working = /working|business/i.test(kind ?? "");
    if (unit!.toLowerCase() === "day") {
      // Working days skip weekends and bank holidays.
      ranges.push(working ? { min: n, max: Math.ceil((n * 7) / 5) + 4 } : { min: n, max: n });
    } else if (unit!.toLowerCase() === "week") {
      ranges.push({ min: 7 * n, max: 7 * n });
    } else {
      ranges.push({ min: 28 * n, max: 31 * n });
    }
  }
  return ranges;
}

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

export function dueDateIsGrounded(
  dueDate: string,
  dueNote: string | null,
  texts: readonly string[],
): boolean {
  const year = Number(dueDate.slice(0, 4));
  const month = Number(dueDate.slice(5, 7));
  const day = Number(dueDate.slice(8, 10));
  const stated = texts.flatMap(extractDates);

  // Stated as it is: "1 March 2026", or "1 March" with no year.
  if (stated.some((d) => d.month === month && d.day === day && (d.year ?? year) === year)) {
    return true;
  }

  // Counted from a stated date, as far from it as the due note says (a day either way, for
  // counting inclusively or not).
  const offsets = dueNote ? noteOffsets(dueNote) : [];
  if (offsets.length === 0) return false;
  return stated.some((d) => {
    const reference = isoDay(d.year ?? year, d.month, d.day);
    if (reference === null) return false;
    const distance = Math.abs(daysBetween(reference, dueDate));
    return offsets.some(({ min, max }) => distance >= min - 1 && distance <= max + 1);
  });
}

function isoDay(year: number, month: number, day: number): string | null {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isCalendarDay(value) ? value : null;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const MONTH_NAME = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORDINAL = String.raw`(?:st|nd|rd|th)?`;

const DAY_MONTH = new RegExp(
  String.raw`\b(\d{1,2})${ORDINAL}\s+(?:of\s+)?${MONTH_NAME}\b\.?(?:,?\s+(\d{4}))?`,
  "gi",
);
const MONTH_DAY = new RegExp(
  String.raw`\b${MONTH_NAME}\.?\s+(\d{1,2})${ORDINAL}\b(?:,?\s+(\d{4}))?`,
  "gi",
);
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
// UK order: day/month/year.
const NUMERIC = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g;

export type StatedDate = { year?: number; month: number; day: number };

// Dates written in a text, in the forms documents and people use.
export function extractDates(text: string): StatedDate[] {
  const dates: StatedDate[] = [];
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase() as never) + 1;
  const push = (day: number, m: number, year?: number) => {
    if (m >= 1 && m <= 12 && day >= 1 && day <= 31) dates.push({ day, month: m, year });
  };

  for (const [, day, name, year] of text.matchAll(DAY_MONTH)) {
    push(Number(day), month(name!), year ? Number(year) : undefined);
  }
  for (const [, name, day, year] of text.matchAll(MONTH_DAY)) {
    push(Number(day), month(name!), year ? Number(year) : undefined);
  }
  for (const [, year, m, day] of text.matchAll(ISO)) push(Number(day), Number(m), Number(year));
  for (const [, day, m, year] of text.matchAll(NUMERIC)) {
    push(Number(day), Number(m), year!.length === 2 ? 2000 + Number(year) : Number(year));
  }
  return dates;
}
