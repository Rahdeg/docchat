// The agent's parts of a chat message (docs/adr/0007): its two tools' inputs and outputs, and
// the checked proposal the approval card shows. Shared by the route, the database (validated
// on load) and the browser.
import { z } from "zod";

import {
  DUE_NOTE_MAX_CHARS,
  SOURCE_LABEL_MAX_CHARS,
  TASK_TITLE_MAX_CHARS,
} from "@/features/tasks/task-rules";

// Tasks one run may propose, and add.
export const MAX_PROPOSED_TASKS = 20;
// Quotes longer than this aren't a sentence; they're cut before matching.
const QUOTE_MAX_CHARS = 600;

export const searchDocumentsInput = z.object({
  query: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe("What to look for, in the document's own words, e.g. 'inventory' or 'deposit'."),
  documentIds: z
    .array(z.uuid())
    .min(1)
    .max(20)
    .optional()
    .describe("Only these documents (ids from <documents>). Leave out to search them all."),
});

// What the browser sees of a search; the model gets the passages' text (toModelOutput).
export const searchDocumentsOutput = z.object({
  // Source numbers of the passages this search added, continuing the run's numbering.
  added: z.array(z.number().int().positive()),
  // Passages found again that already had a number.
  repeated: z.array(z.number().int().positive()),
});

export const proposedTaskInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(TASK_TITLE_MAX_CHARS)
    .describe("A short instruction, like 'Return the signed inventory'."),
  dueDate: z
    .string()
    .optional()
    .describe(
      "YYYY-MM-DD. Only when the source states the date, or the user gave the date the deadline counts from. Otherwise leave it out.",
    ),
  dueNote: z
    .string()
    .trim()
    .max(DUE_NOTE_MAX_CHARS)
    .optional()
    .describe("The deadline in words, as the source puts it, e.g. 'within 7 days of moving in'."),
  optional: z
    .boolean()
    .optional()
    .describe("True when the document advises it but doesn't require it."),
  source: z.object({
    number: z.number().int().positive().describe("The id of the <source> the task comes from."),
    quote: z
      .string()
      .trim()
      .min(1)
      .max(QUOTE_MAX_CHARS)
      .describe("The sentence in that source the task comes from, copied word for word."),
    label: z
      .string()
      .trim()
      .max(SOURCE_LABEL_MAX_CHARS)
      .optional()
      .describe(
        "Where in the document, as it numbers it: 'clause 6.1', 'section 3', 'Assessment'.",
      ),
  }),
});

export const proposeTasksInput = z.object({
  tasks: z.array(proposedTaskInput).min(1).max(MAX_PROPOSED_TASKS),
});

export type ProposeTasksInput = z.infer<typeof proposeTasksInput>;
export type ProposedTaskInput = z.infer<typeof proposedTaskInput>;

// After the user approves or cancels. Written by the server, never by the model.
export const proposeTasksOutput = z.object({ added: z.number().int().nonnegative() });

// A proposed task after the server checked it: its source is one of this run's passages, its
// quote was looked for in that passage, and its date is one the documents or the user gave.
export const checkedTaskSchema = z.object({
  title: z.string(),
  dueDate: z.iso.date().nullable(),
  dueNote: z.string().nullable(),
  // The model gave a date that no source or message of the user's states; it was dropped.
  dateDropped: z.boolean(),
  optional: z.boolean(),
  // The passage's number in the run (data-passages[source - 1]).
  source: z.number().int().positive(),
  // The chip shown on the task, numbered with the answer's citations.
  citation: z.number().int().positive(),
  quote: z.string(),
  // Offsets of the quote in the passage; the whole passage when it wasn't found (matched false).
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  matched: z.boolean(),
  label: z.string().nullable(),
});

export type CheckedTask = z.infer<typeof checkedTaskSchema>;

export const proposalSchema = z.object({
  toolCallId: z.string(),
  tasks: z.array(checkedTaskSchema),
  // Proposed tasks dropped because their source wasn't one of this run's passages.
  rejected: z.number().int().nonnegative(),
});

export type Proposal = z.infer<typeof proposalSchema>;

// What the browser sends with "Add N tasks": the ticked tasks, by their index in the proposal,
// with the title and date the user left them with.
export const approvedTaskSchema = z.object({
  index: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_PROPOSED_TASKS - 1),
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_CHARS),
  dueDate: z.iso.date().nullable(),
});

export type ApprovedTask = z.infer<typeof approvedTaskSchema>;

export const approvalRequestSchema = z.object({
  // The answer holding the proposal.
  messageId: z.uuid(),
  approvalId: z.string().min(1).max(100),
  approved: z.boolean(),
  // Approve only.
  tasks: z.array(approvedTaskSchema).max(MAX_PROPOSED_TASKS).optional(),
});

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export function addedTasksText(count: number): string {
  return `Added ${count} ${count === 1 ? "task" : "tasks"}. See them on the Tasks page.`;
}

export const NO_TASKS_ADDED = "No tasks were added.";

// The agent's tools as stored messages are validated against them (listMessages).
export const chatToolSchemas = {
  searchDocuments: { inputSchema: searchDocumentsInput, outputSchema: searchDocumentsOutput },
  proposeTasks: { inputSchema: proposeTasksInput, outputSchema: proposeTasksOutput },
};
