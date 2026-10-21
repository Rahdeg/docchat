import "server-only";

import { boolean, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, id, userId } from "./columns";
import { chunk } from "./documents";

export const task = pgTable(
  "task",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    // Calendar day as "YYYY-MM-DD"; no time or timezone.
    dueDate: date("due_date", { mode: "string" }),
    done: boolean("done").notNull().default(false),
    // The chunk the task was extracted from. Kept when the source document is deleted.
    sourceChunkId: uuid("source_chunk_id").references(() => chunk.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("task_user_id_idx").on(t.userId),
    // Lets chunk deletes find the tasks to set null without a full scan.
    index("task_source_chunk_id_idx").on(t.sourceChunkId),
  ],
);

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
