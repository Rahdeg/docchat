import "server-only";

import { index, integer, pgTable, text, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

import { EMBEDDING_DIMENSIONS } from "@/server/ai/constants";

import { createdAt, id, updatedAt, userId } from "./columns";
import { documentStatus } from "./enums";

export const document = pgTable(
  "document",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Path of the original file in the private Blob store (users/<userId>/<uuid>-<name>).
    // Null only for seeded sample rows, which have no file.
    blobPathname: text("blob_pathname"),
    status: documentStatus("status").notNull().default("uploaded"),
    error: text("error"),
    pageCount: integer("page_count"),
    // Pages extracted so far while indexing, for "Reading page X of Y".
    pagesRead: integer("pages_read").notNull().default(0),
    createdAt: createdAt(),
    // Also bumped by each progress update, so an `indexing` row whose updatedAt is old is stuck.
    updatedAt: updatedAt(),
  },
  (t) => [
    index("document_user_id_idx").on(t.userId),
    uniqueIndex("document_blob_pathname_idx").on(t.blobPathname),
  ],
);

// Extracted text, one row per page. Chunk offsets point into `text`, so a citation can be
// resolved to an exact span (docs/adr/0004).
export const documentPage = pgTable(
  "document_page",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    userId: userId(),
    // 1-based. Markdown and text files are a single page.
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("document_page_user_id_idx").on(t.userId),
    uniqueIndex("document_page_document_id_page_number_idx").on(t.documentId, t.pageNumber),
  ],
);

export const chunk = pgTable(
  "chunk",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    // Copied from the document so vector search can filter by user without a join.
    userId: userId(),
    content: text("content").notNull(),
    page: integer("page"),
    position: integer("position").notNull(),
    tokenCount: integer("token_count").notNull(),
    // Character offsets into the page's text (document_page.text): content is exactly
    // text.slice(startOffset, endOffset).
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    // TODO(embeddings, PR 5): make both notNull once existing chunks are backfilled.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    // The model that made `embedding` (EMBEDDING_MODEL, e.g. "google/gemini-embedding-001").
    // Vectors from different models can't be compared: search skips chunks from other models,
    // and `pnpm db:backfill-embeddings` re-embeds them.
    embeddingModel: text("embedding_model"),
    createdAt: createdAt(),
  },
  (t) => [
    index("chunk_user_id_idx").on(t.userId),
    index("chunk_document_id_position_idx").on(t.documentId, t.position),
    // Cosine distance: query with `<=>` (Drizzle's cosineDistance) so the index is used.
    index("chunk_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type DocumentStatus = Document["status"];
export type DocumentPage = typeof documentPage.$inferSelect;
export type Chunk = typeof chunk.$inferSelect;
export type NewChunk = typeof chunk.$inferInsert;
