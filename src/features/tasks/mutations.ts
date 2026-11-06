import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { chat, chunk, document, task, type NewTask, type Task } from "@/server/db/schema";

import type { CalendarDay } from "./task-rules";

// Writes on a user's tasks. Each takes userId first and filters by it. The agent's tasks are
// added by createAgentTasks (agent-tasks.ts), only after the user approves them.

export async function createTask(
  userId: string,
  input: { title: string; dueDate: CalendarDay | null },
): Promise<Task> {
  const [created] = await db
    .insert(task)
    .values({ userId, title: input.title, dueDate: input.dueDate, createdBy: "user" })
    .returning();
  return created!;
}

export type McpTaskSource = {
  documentId: string;
  chunkId: string;
  quote: string;
  // The quote's offsets in the chunk's content.
  start: number;
  end: number;
  label: string | null;
};

// A task from the user's connected AI app (MCP create_task, docs/adr/0008). The source, if
// any, was already checked against the user's own document (src/server/mcp/tools.ts).
export async function createMcpTask(
  userId: string,
  input: {
    title: string;
    dueDate: CalendarDay | null;
    dueNote: string | null;
    source: McpTaskSource | null;
  },
): Promise<Task> {
  const { source } = input;
  const [created] = await db
    .insert(task)
    .values({
      userId,
      title: input.title,
      dueDate: input.dueDate,
      dueNote: input.dueNote,
      createdBy: "mcp",
      sourceDocumentId: source?.documentId ?? null,
      sourceChunkId: source?.chunkId ?? null,
      sourceQuote: source?.quote ?? null,
      sourceStartOffset: source?.start ?? null,
      sourceEndOffset: source?.end ?? null,
      sourceLabel: source?.label ?? null,
    })
    .returning();
  return created!;
}

// Changes the title, the due date (null clears it), or both. Returns false when the task
// isn't the user's.
export async function updateTask(
  userId: string,
  id: string,
  changes: { title?: string; dueDate?: CalendarDay | null },
): Promise<boolean> {
  const rows = await db
    .update(task)
    .set(changes)
    .where(and(eq(task.userId, userId), eq(task.id, id)))
    .returning({ id: task.id });
  return rows.length > 0;
}

export async function setTaskDone(userId: string, id: string, done: boolean): Promise<boolean> {
  const rows = await db
    .update(task)
    .set({ done, completedAt: done ? new Date() : null })
    .where(and(eq(task.userId, userId), eq(task.id, id)))
    .returning({ id: task.id });
  return rows.length > 0;
}

// Deletes the task and returns it, so "Undo" can put it back (restoreTask).
export async function deleteTask(userId: string, id: string): Promise<Task | null> {
  const [deleted] = await db
    .delete(task)
    .where(and(eq(task.userId, userId), eq(task.id, id)))
    .returning();
  return deleted ?? null;
}

export type RestoredTask = Omit<NewTask, "userId">;

// "Undo" after a delete: inserts the task again with its id. The snapshot comes back from the
// browser, so links to a document, chunk or chat are kept only if they're still the user's.
// Returns false when a task with that id already exists.
export async function restoreTask(userId: string, snapshot: RestoredTask): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owns = async (
      table: typeof document | typeof chunk | typeof chat,
      id?: string | null,
    ) => {
      if (!id) return false;
      const [row] = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.id, id)))
        .limit(1);
      return !!row;
    };
    const values: NewTask = {
      ...snapshot,
      userId,
      sourceDocumentId: (await owns(document, snapshot.sourceDocumentId))
        ? snapshot.sourceDocumentId
        : null,
      sourceChunkId: (await owns(chunk, snapshot.sourceChunkId)) ? snapshot.sourceChunkId : null,
      chatId: (await owns(chat, snapshot.chatId)) ? snapshot.chatId : null,
    };
    const rows = await tx
      .insert(task)
      .values(values)
      .onConflictDoNothing({ target: task.id })
      .returning({ id: task.id });
    return rows.length > 0;
  });
}
