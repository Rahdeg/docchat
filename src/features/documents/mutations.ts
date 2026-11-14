import "server-only";

import { and, count, eq, ne, or, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { document, type Document, type NewDocument } from "@/server/db/schema";

import { isStuck } from "./queries";

// Writes on a user's documents. Like queries.ts, each takes userId first and filters by it.

type NewUpload = Pick<NewDocument, "name" | "mimeType" | "sizeBytes" | "blobPathname">;

export type CreateResult = { ok: true; document: Document } | { ok: false; max: number };

// Inserts an uploaded document, if the user is under `maxDocuments` (null: no limit). Counting
// and inserting happen under a per-user advisory lock (released at commit), so two uploads at
// the same moment are counted one after the other: at 2 of 3, one gets the last slot and the
// other is refused. Registering the same Blob path twice (a double submit) returns the
// existing row instead, without counting it again.
export async function createDocument(
  userId: string,
  values: NewUpload,
  maxDocuments: number | null,
): Promise<CreateResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`documents:${userId}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(document)
      .where(and(eq(document.userId, userId), eq(document.blobPathname, values.blobPathname ?? "")))
      .limit(1);
    if (existing) return { ok: true, document: existing };

    if (maxDocuments !== null) {
      const [row] = await tx
        .select({ n: count() })
        .from(document)
        .where(eq(document.userId, userId));
      if ((row?.n ?? 0) >= maxDocuments) return { ok: false, max: maxDocuments };
    }

    const [created] = await tx
      .insert(document)
      .values({ ...values, userId, status: "uploaded" })
      .onConflictDoNothing({ target: document.blobPathname })
      .returning();
    if (!created) throw new Error("Blob path is registered to another user");
    return { ok: true, document: created };
  });
}

// Records the file's hash on a document being read, and returns another of the user's documents
// with the same file, if there is one (a failed copy doesn't count). Under a per-user lock on
// the hash, so of two copies read at the same moment the second always sees the first.
export async function claimContentHash(
  userId: string,
  documentId: string,
  contentHash: string,
): Promise<Pick<Document, "id" | "name"> | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`content:${userId}:${contentHash}`}, 0))`,
    );
    const [copy] = await tx
      .select({ id: document.id, name: document.name })
      .from(document)
      .where(
        and(
          eq(document.userId, userId),
          eq(document.contentHash, contentHash),
          ne(document.id, documentId),
          ne(document.status, "failed"),
        ),
      )
      .limit(1);
    await tx
      .update(document)
      .set({ contentHash })
      .where(and(eq(document.userId, userId), eq(document.id, documentId)));
    return copy ?? null;
  });
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
