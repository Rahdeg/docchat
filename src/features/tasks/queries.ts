import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { chunk, document, task } from "@/server/db/schema";

import type { TaskItem } from "./task-rules";

// The user's tasks with their sources: the document's name and the passage the task came
// from, for the source popover. Open tasks first, soonest due first.
export async function listTasks(userId: string): Promise<TaskItem[]> {
  const rows = await db
    .select({
      task,
      documentName: document.name,
      mimeType: document.mimeType,
      hasFile: sql<boolean>`${document.blobPathname} is not null`,
      passage: chunk.content,
      page: chunk.page,
    })
    .from(task)
    // Joined on the user too: a task can only ever show its owner's documents.
    .leftJoin(document, and(eq(document.userId, userId), eq(document.id, task.sourceDocumentId)))
    .leftJoin(chunk, and(eq(chunk.userId, userId), eq(chunk.id, task.sourceChunkId)))
    .where(eq(task.userId, userId))
    .orderBy(asc(task.done), sql`${task.dueDate} asc nulls last`, desc(task.createdAt));

  return rows.map(({ task: t, ...source }) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    dueNote: t.dueNote,
    done: t.done,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    createdBy: t.createdBy,
    source:
      t.sourceQuote || t.sourceLabel || t.sourceDocumentId
        ? {
            documentId: t.sourceDocumentId,
            documentName: source.documentName,
            mimeType: source.mimeType,
            hasFile: source.hasFile ?? false,
            page: source.page,
            passage: source.passage,
            quote: t.sourceQuote,
            start: source.passage ? t.sourceStartOffset : null,
            end: source.passage ? t.sourceEndOffset : null,
            label: t.sourceLabel,
          }
        : null,
  }));
}

export async function countOpenTasks(userId: string): Promise<number> {
  return db.$count(task, and(eq(task.userId, userId), eq(task.done, false)));
}
