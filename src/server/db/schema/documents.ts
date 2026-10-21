import "server-only";

import { index, integer, pgTable, text, uuid, vector } from "drizzle-orm/pg-core";

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
    status: documentStatus("status").notNull().default("uploaded"),
    error: text("error"),
    pageCount: integer("page_count"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("document_user_id_idx").on(t.userId)],
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
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
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
export type Chunk = typeof chunk.$inferSelect;
export type NewChunk = typeof chunk.$inferInsert;
