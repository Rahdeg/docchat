import "server-only";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/server/db";
import { chunk, document } from "@/server/db/schema";

import { embedQuery } from "./embed";
import { EMBEDDING_MODEL } from "./models";

export type Passage = {
  chunkId: string;
  documentId: string;
  // Document name.
  name: string;
  mimeType: string;
  // False for seeded sample documents, which have no stored file to open.
  hasFile: boolean;
  page: number | null;
  content: string;
  // Offsets of `content` in the page's text (docs/adr/0004).
  startOffset: number;
  endOffset: number;
  // Cosine similarity, 1 - cosine distance. Higher is closer.
  similarity: number;
};

type SearchOptions = {
  userId: string;
  // Only these documents (still only the user's own, ready ones).
  documentIds?: readonly string[];
  limit?: number;
  // Drop passages below this similarity. None by default, so the eval measures raw ranking;
  // /chat passes MIN_SIMILARITY.
  minSimilarity?: number;
};

// The user's passages closest to a question, best first. Embeds the query (recorded as
// `embed-query` usage), then searches only the user's ready documents, and only chunks embedded
// by the same model as the query.
export async function searchPassages({
  query,
  ...options
}: SearchOptions & { query: string }): Promise<Passage[]> {
  const embedding = await embedQuery(options.userId, query);
  return searchByEmbedding(embedding, options);
}

type Row = {
  chunk_id: string;
  document_id: string;
  name: string;
  mime_type: string;
  has_file: boolean;
  page: number | null;
  content: string;
  start_offset: number;
  end_offset: number;
  distance: number;
};

// Nearest chunks to an embedding by cosine distance, using the HNSW index (docs/adr/0005).
//
// HNSW filters *after* the index scan: by default it finds 40 candidates (hnsw.ef_search)
// across all users, then drops the ones that aren't this user's or aren't ready, which can
// leave fewer than `limit`. Iterative scans (pgvector 0.8) keep scanning until `limit` rows
// survive the filters and the join, up to hnsw.max_scan_tuples (20,000). relaxed_order has
// better recall than strict_order but may return rows slightly out of order, so the
// materialized CTE takes the top rows and the outer query sorts them exactly (`+ 0` stops
// Postgres 17+ from folding the two sorts into one).
//
// SET LOCAL lasts only for this transaction, which is what makes it safe through the pooled
// (PgBouncer, transaction mode) connection. A plain SET would leak to other clients.
//
// `executor` lets a test run the search inside its own transaction (with planner settings that
// force the HNSW path); the search then runs in a savepoint.
export async function searchByEmbedding(
  embedding: readonly number[],
  { userId, documentIds, limit = 5, minSimilarity }: SearchOptions,
  executor: Pick<Db, "transaction"> = db,
): Promise<Passage[]> {
  if (documentIds?.length === 0) return [];
  const vector = `[${embedding.join(",")}]`;
  const distance = sql`${chunk.embedding} <=> ${vector}::vector`;
  const inDocuments = documentIds
    ? sql`and ${chunk.documentId} in (${sql.join(
        documentIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;

  const rows = await executor.transaction(async (tx) => {
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    const result = await tx.execute<Row>(sql`
      with nearest as materialized (
        select
          ${chunk.id} as chunk_id,
          ${chunk.documentId} as document_id,
          ${document.name} as name,
          ${document.mimeType} as mime_type,
          ${document.blobPathname} is not null as has_file,
          ${chunk.page} as page,
          ${chunk.content} as content,
          ${chunk.startOffset} as start_offset,
          ${chunk.endOffset} as end_offset,
          ${distance} as distance
        from ${chunk}
        inner join ${document}
          on ${document.id} = ${chunk.documentId} and ${document.userId} = ${userId}
        where ${chunk.userId} = ${userId}
          and ${chunk.embeddingModel} = ${EMBEDDING_MODEL}
          and ${document.status} = 'ready'
          ${inDocuments}
        order by ${distance}
        limit ${limit}
      )
      select * from nearest order by distance + 0
    `);
    return result.rows;
  });

  return rows
    .map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      name: row.name,
      mimeType: row.mime_type,
      hasFile: row.has_file,
      page: row.page,
      content: row.content,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      similarity: 1 - Number(row.distance),
    }))
    .filter((passage) => minSimilarity === undefined || passage.similarity >= minSimilarity);
}
