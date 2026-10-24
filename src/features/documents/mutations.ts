import "server-only";

import { and, eq, or } from "drizzle-orm";

import { db } from "@/server/db";
import { document, type Document, type NewDocument } from "@/server/db/schema";

import { getDocumentByBlobPathname, isStuck } from "./queries";

// Writes on a user's documents. Like queries.ts, each takes userId first and filters by it.

type NewUpload = Pick<NewDocument, "name" | "mimeType" | "sizeBytes" | "blobPathname">;

// Inserts an uploaded document. Registering the same Blob path twice (a double submit) returns
// the existing row instead of failing on the unique index.
export async function createDocument(userId: string, values: NewUpload): Promise<Document> {
  const [created] = await db
    .insert(document)
    .values({ ...values, userId, status: "uploaded" })
    .onConflictDoNothing({ target: document.blobPathname })
    .returning();
  if (created) return created;

  const existing = await getDocumentByBlobPathname(userId, values.blobPathname ?? "");
  if (!existing) throw new Error("Blob path is registered to another user");
  return existing;
}

// Puts a failed or stuck document back in the queue. Returns null when it's neither, so two
// quick retries can't both start indexing. Bumps updatedAt, so it's no longer stuck.
export async function resetForRetry(userId: string, documentId: string): Promise<Document | null> {
  const [row] = await db
    .update(document)
    .set({ status: "uploaded", error: null, pagesRead: 0, pageCount: null })
    .where(
      and(
        eq(document.userId, userId),
        eq(document.id, documentId),
        or(eq(document.status, "failed"), isStuck),
      ),
    )
    .returning();
  return row ?? null;
}

// Deletes the row; its pages and chunks go with it (cascade). Returns what was deleted, so the
// caller can remove the stored file.
export async function deleteDocument(
  userId: string,
  documentId: string,
): Promise<Pick<Document, "name" | "blobPathname"> | null> {
  const [row] = await db
    .delete(document)
    .where(and(eq(document.userId, userId), eq(document.id, documentId)))
    .returning({ name: document.name, blobPathname: document.blobPathname });
  return row ?? null;
}
