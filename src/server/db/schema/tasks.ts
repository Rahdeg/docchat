import "server-only";

import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { chat } from "./chats";
import { createdAt, id, userId } from "./columns";
import { chunk, document } from "./documents";
import { taskCreatedBy } from "./enums";

export const task = pgTable(
  "task",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    // Calendar day as "YYYY-MM-DD"; no time or timezone. Only set when the document states the
    // date or the user gave the date it counts from (docs/adr/0007).
    dueDate: date("due_date", { mode: "string" }),
    // A deadline in words, e.g. "within 7 days of moving in", when there's no date to count from.
    dueNote: text("due_note"),
    done: boolean("done").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: taskCreatedBy("created_by").notNull().default("user"),
    // The chat the agent proposed the task in.
    chatId: uuid("chat_id").references(() => chat.id, { onDelete: "set null" }),
    // Where an agent task came from. The document and chunk links go when the document is
    // deleted or read again; the quote and label stay, so the task still says where it came from.
    sourceDocumentId: uuid("source_document_id").references(() => document.id, {
      onDelete: "set null",
    }),
    sourceChunkId: uuid("source_chunk_id").references(() => chunk.id, { onDelete: "set null" }),
    sourceQuote: text("source_quote"),
    // The quote's position in the chunk's content, like a citation's start and end. The whole
    // chunk when the quote wasn't found in it.
    sourceStartOffset: integer("source_start_offset"),
    sourceEndOffset: integer("source_end_offset"),
    // Where in the document, as the document numbers it: "clause 4.2", "Assessment".
    sourceLabel: text("source_label"),
    createdAt: createdAt(),
  },
  (t) => [
    index("task_user_id_idx").on(t.userId),
    // The Tasks page: open or done, by due date.
    index("task_user_id_done_due_date_idx").on(t.userId, t.done, t.dueDate),
    // Let chunk, document and chat deletes find the tasks to set null without a full scan.
    index("task_source_chunk_id_idx").on(t.sourceChunkId),
    index("task_source_document_id_idx").on(t.sourceDocumentId),
    index("task_chat_id_idx").on(t.chatId),
  ],
);

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
export type TaskCreatedBy = Task["createdBy"];
