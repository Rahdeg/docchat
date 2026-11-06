import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/server/db";
import {
  aiUsage,
  chat,
  chunk,
  document,
  documentPage,
  message,
  rateLimitEvent,
  task,
} from "@/server/db/schema";

import { deleteBlobsWithPrefix } from "./blob";

// Deleting a user's data when their Clerk account is deleted (POST /api/webhooks/clerk,
// docs/adr/0008). There's no users table: every user-data table has a user_id column.

// Clerk user ids: "user_" and letters and digits. Checked before the id goes into a Blob prefix.
export const clerkUserIdSchema = z.string().regex(/^user_[A-Za-z0-9]+$/);

export type DeletedRows = Record<
  "tasks" | "messages" | "chats" | "chunks" | "pages" | "documents" | "aiUsage" | "rateLimits",
  number
>;

// Every row of the user's, in one transaction: all of it goes or none does. Children first, so
// nothing waits on a cascade or a set-null. Running it again deletes nothing.
export async function deleteUserRows(userId: string): Promise<DeletedRows> {
  return db.transaction(async (tx) => {
    const count = async (rows: Promise<unknown[]>) => (await rows).length;
    return {
      tasks: await count(tx.delete(task).where(eq(task.userId, userId)).returning({ id: task.id })),
      messages: await count(
        tx.delete(message).where(eq(message.userId, userId)).returning({ id: message.id }),
      ),
      chats: await count(tx.delete(chat).where(eq(chat.userId, userId)).returning({ id: chat.id })),
      chunks: await count(
        tx.delete(chunk).where(eq(chunk.userId, userId)).returning({ id: chunk.id }),
      ),
      pages: await count(
        tx
          .delete(documentPage)
          .where(eq(documentPage.userId, userId))
          .returning({ id: documentPage.id }),
      ),
      documents: await count(
        tx.delete(document).where(eq(document.userId, userId)).returning({ id: document.id }),
      ),
      aiUsage: await count(
        tx.delete(aiUsage).where(eq(aiUsage.userId, userId)).returning({ id: aiUsage.id }),
      ),
      rateLimits: await count(
        tx
          .delete(rateLimitEvent)
          .where(eq(rateLimitEvent.userId, userId))
          .returning({ id: rateLimitEvent.id }),
      ),
    };
  });
}

// The user's rows, then every file in their Blob folder (users/<userId>/), including uploads
// that were never registered. Files can't be part of the transaction, so they go after it: if
// that fails, the caller answers 500 and Clerk retries; the rows are already gone and the files
// are found again by their folder.
export async function deleteUserData(
  userId: string,
): Promise<{ rows: DeletedRows; files: number }> {
  const id = clerkUserIdSchema.parse(userId);
  const rows = await deleteUserRows(id);
  const files = await deleteBlobsWithPrefix(`users/${id}/`);
  return { rows, files };
}
