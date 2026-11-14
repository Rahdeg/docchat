import "server-only";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

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

export type ReadyDocument = Pick<Document, "id" | "name">;

// The documents a search can cover, for the composer's document picker.
export async function listReadyDocuments(userId: string): Promise<ReadyDocument[]> {
  return db
    .select({ id: document.id, name: document.name })
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.status, "ready")))
    .orderBy(asc(document.name));
}

export type DocumentChunk = { id: string; content: string; page: number | null };

// A ready document's passages in order, for finding a quote in it (an MCP task's source).
// Empty when the document isn't the user's or isn't ready.
export async function listDocumentChunks(
  userId: string,
  documentId: string,
): Promise<DocumentChunk[]> {
  return db
    .select({ id: chunk.id, content: chunk.content, page: chunk.page })
    .from(chunk)
    .innerJoin(
      document,
      and(
        eq(document.id, chunk.documentId),
        eq(document.userId, userId),
        eq(document.status, "ready"),
      ),
    )
    .where(and(eq(chunk.userId, userId), eq(chunk.documentId, documentId)))
    .orderBy(asc(chunk.position));
}

// One of the user's documents (not a failed one) with this file, for the browser's check before
// it uploads a file the user already has.
export async function findByContentHash(
  userId: string,
  contentHash: string,
): Promise<Pick<Document, "id" | "name"> | null> {
  const [row] = await db
    .select({ id: document.id, name: document.name })
    .from(document)
    .where(
      and(
        eq(document.userId, userId),
        eq(document.contentHash, contentHash),
        ne(document.status, "failed"),
      ),
    )
    .limit(1);
  return row ?? null;
}
