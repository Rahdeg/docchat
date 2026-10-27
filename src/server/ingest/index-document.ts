import "server-only";

import { and, eq, TransactionRollbackError } from "drizzle-orm";

import { fileKindOf, fileKindOfMimeType } from "@/features/documents/upload-rules";
import { chunkPages } from "@/server/ai/chunk";
import { embedChunks } from "@/server/ai/embed";
import { EMBEDDING_MODEL } from "@/server/ai/models";
import { downloadBlob } from "@/server/blob";
import { db } from "@/server/db";
import { chunk, document, documentPage } from "@/server/db/schema";

import { extractPages, IndexingError, messages } from "./extract";

// TODO(queue): indexing runs in after(), which isn't durable: if the function times out or
// crashes, the document stays `indexing` until the Library shows it as stuck (10 minutes) and
// the user retries. Move this to a durable queue (Inngest, Vercel Queues…) in a later PR.

// Rows per INSERT, well under Postgres's 65,535 bind-parameter limit.
const INSERT_BATCH = 500;

// Write "Reading page X of Y" at most this often, plus the first and last page.
const PROGRESS_INTERVAL_MS = 750;

// The document was deleted or reset while we were working on it.
class AbandonedError extends Error {}

type IndexOptions = {
  // Where the file's bytes come from. Tests pass a fixture instead of reading Blob.
  load?: (blobPathname: string) => Promise<Uint8Array | null>;
};

// Reads a document's file, stores its pages and embedded chunks, and marks it ready (or failed with a
// message the user can act on). Only picks up documents in `uploaded`, so a second call for the
// same document does nothing, and a retry (which resets the status) re-indexes from scratch.
export async function indexDocument(
  userId: string,
  documentId: string,
  { load = downloadBlob }: IndexOptions = {},
): Promise<void> {
  const where = and(eq(document.userId, userId), eq(document.id, documentId));

  // Claim it. Also clears progress from an earlier attempt.
  const [doc] = await db
    .update(document)
    .set({ status: "indexing", error: null, pagesRead: 0, pageCount: null })
    .where(and(where, eq(document.status, "uploaded")))
    .returning();
  if (!doc) return;

  const stillIndexing = and(where, eq(document.status, "indexing"));

  try {
    const kind = fileKindOfMimeType(doc.mimeType) ?? fileKindOf(doc.name);
    if (!kind) throw new IndexingError(messages.generic);

    const bytes = doc.blobPathname ? await load(doc.blobPathname) : null;
    if (!bytes) throw new IndexingError(messages.missing);

    let lastWrite = 0;
    const pages = await extractPages(bytes, kind, async (pagesRead, pageCount) => {
      const now = Date.now();
      if (pagesRead > 1 && pagesRead < pageCount && now - lastWrite < PROGRESS_INTERVAL_MS) return;
      lastWrite = now;
      // Also bumps updatedAt, so a long document that's still moving isn't "stuck".
      await db.update(document).set({ pagesRead, pageCount }).where(stillIndexing);
    });

    if (!pages.some((text) => text.length > 0)) {
      throw new IndexingError(kind === "pdf" ? messages.noText : messages.empty);
    }

    const chunks = chunkPages(pages);

    // Embed before the transaction, so it holds its locks only for the inserts. Every page is
    // read by now, so the Library shows "Almost ready". Each batch bumps updatedAt, so a long
    // document that's still embedding isn't "stuck", and stops early if the row is gone.
    const embeddings = await embedChunks(userId, chunks, {
      onBatch: async () => {
        const [still] = await db
          .update(document)
          .set({ updatedAt: new Date() })
          .where(stillIndexing)
          .returning({ id: document.id });
        if (!still) throw new AbandonedError();
      },
    });

    await db.transaction(async (tx) => {
      // Re-indexing replaces everything, so a retry can never duplicate pages or chunks.
      await tx.delete(chunk).where(and(eq(chunk.userId, userId), eq(chunk.documentId, documentId)));
      await tx
        .delete(documentPage)
        .where(and(eq(documentPage.userId, userId), eq(documentPage.documentId, documentId)));

      const pageRows = pages.map((text, index) => ({
        documentId,
        userId,
        pageNumber: index + 1,
        text,
      }));
      for (let i = 0; i < pageRows.length; i += INSERT_BATCH) {
        await tx.insert(documentPage).values(pageRows.slice(i, i + INSERT_BATCH));
      }

      const chunkRows = chunks.map((c, i) => ({
        documentId,
        userId,
        content: c.content,
        page: c.page,
        position: c.position,
        tokenCount: c.tokenCount,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        embedding: embeddings[i]!,
        embeddingModel: EMBEDDING_MODEL,
      }));
      for (let i = 0; i < chunkRows.length; i += INSERT_BATCH) {
        await tx.insert(chunk).values(chunkRows.slice(i, i + INSERT_BATCH));
      }

      const [ready] = await tx
        .update(document)
        .set({ status: "ready", error: null, pageCount: pages.length, pagesRead: pages.length })
        .where(stillIndexing)
        .returning({ id: document.id });
      // Deleted or reset while we were reading: keep nothing.
      if (!ready) tx.rollback();
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError || error instanceof AbandonedError) return;
    if (!(error instanceof IndexingError)) {
      console.error(`Indexing document ${documentId} failed`, error);
    }
    const message = error instanceof IndexingError ? error.message : messages.generic;
    await db
      .update(document)
      .set({ status: "failed", error: message })
      .where(stillIndexing)
      .catch((updateError: unknown) => console.error(updateError));
  }
}
