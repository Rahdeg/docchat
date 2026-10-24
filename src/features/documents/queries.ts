import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  chunk,
  document,
  documentPage,
  type Document,
  type DocumentStatus,
} from "@/server/db/schema";

import { PREVIEW_CHARS, STUCK_AFTER_MINUTES, type LibraryDocument } from "./library-document";

// An uploaded/indexing document that hasn't moved for STUCK_AFTER_MINUTES. The database's clock
// decides, so it agrees with updated_at.
export const isStuck = sql<boolean>`(${document.status} in ('uploaded', 'indexing') and ${document.updatedAt} < now() - ${sql.raw(`interval '${STUCK_AFTER_MINUTES} minutes'`)})`;

export async function listDocuments(userId: string): Promise<LibraryDocument[]> {
  const rows = await db
    .select({
      id: document.id,
      name: document.name,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      error: document.error,
      pageCount: document.pageCount,
      pagesRead: document.pagesRead,
      passageCount: db.$count(
        chunk,
        and(eq(chunk.userId, userId), eq(chunk.documentId, document.id)),
      ),
      preview: sql<string | null>`left(${documentPage.text}, ${PREVIEW_CHARS})`,
      hasFile: sql<boolean>`${document.blobPathname} is not null`,
      stuck: isStuck,
      createdAt: document.createdAt,
    })
    .from(document)
    .leftJoin(
      documentPage,
      and(
        eq(documentPage.userId, userId),
        eq(documentPage.documentId, document.id),
        eq(documentPage.pageNumber, 1),
      ),
    )
    .where(eq(document.userId, userId))
    .orderBy(desc(document.createdAt));

  return rows.map((row) => ({ ...row, passageCount: Number(row.passageCount) }));
}

export async function getDocument(userId: string, documentId: string): Promise<Document | null> {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.id, documentId)))
    .limit(1);
  return row ?? null;
}

export async function getDocumentByBlobPathname(
  userId: string,
  blobPathname: string,
): Promise<Document | null> {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.blobPathname, blobPathname)))
    .limit(1);
  return row ?? null;
}

export async function countDocuments(userId: string, status?: DocumentStatus): Promise<number> {
  return db.$count(
    document,
    and(eq(document.userId, userId), status ? eq(document.status, status) : undefined),
  );
}
