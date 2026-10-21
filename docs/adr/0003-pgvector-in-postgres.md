# ADR 0003: Vectors in Postgres with pgvector

- Status: Accepted
- Date: 2026-10-21

## Context

Answering a question means finding the chunks of the user's own documents that are closest to the
question's embedding, then returning them with their document name and page for citations. The
rest of our data (documents, chats, messages, tasks) already lives in Neon Postgres.

We could store embeddings in that same database with the `pgvector` extension, or in a separate
vector database (Pinecone, Qdrant, Weaviate and similar) keyed by chunk ID.

## Decision

Store embeddings in Postgres with `pgvector`:

- `chunk.embedding` is a `vector(EMBEDDING_DIMENSIONS)` column next to the chunk's text, page and
  position. `EMBEDDING_DIMENSIONS` lives in `src/server/ai/constants.ts`.
- An HNSW index with `vector_cosine_ops`. Queries rank by cosine distance (`<=>`, Drizzle's
  `cosineDistance`), so they use the index.
- The extension is enabled by the first migration (`drizzle/0000_enable_pgvector.sql`), before
  any table that uses it.

## Why the same database

- **One source of truth.** A chunk's text, metadata and vector are one row. Indexing a document
  writes its chunks in one transaction, so a search can never return a vector whose chunk was
  deleted, or miss chunks of a document marked `ready`. With two stores we would need dual writes,
  retries and a reconciliation job to get close to this.
- **Joins.** A search returns the chunk, its document's name and status, and later the tasks
  created from it, in one query. A separate store returns IDs that we would then look up in
  Postgres on every question.
- **Row-level filtering by `userId`.** `chunk.user_id` is filtered in the same SQL statement as the
  vector ranking, using the same rule as every other query ("every query filters by `userId`").
  Tenant isolation doesn't depend on keeping metadata filters in sync in a second system.
- **Deletes cascade.** Deleting a document removes its chunks and vectors through a foreign key.
  Nothing is left orphaned elsewhere.
- **Less to run.** No extra service, API key, bill or backup story. Neon branches copy vectors with
  everything else, so a dev or preview branch has a working search index.

## Trade-offs

- **Scale ceiling.** HNSW in Postgres is comfortable into the low millions of vectors on modest
  compute. Very large corpora or high query rates would need more memory, careful tuning or a
  dedicated store.
- **Filtered search and recall.** HNSW applies the `userId` filter after finding candidates. A
  small user in a large table can get fewer than `k` results unless we raise `hnsw.ef_search` or
  use iterative scans (`hnsw.iterative_scan`, pgvector 0.8+). We'll tune this when we write the
  retrieval query.
- **Shared resources.** Index builds and vector queries share CPU and memory with the rest of the
  app's queries.
- **Fixed dimensions.** Changing the embedding model's output size means a migration for the
  column and index, and re-embedding every chunk. A separate store has the same re-embedding cost.

## Alternatives considered

- **Dedicated vector database.** Faster at very large scale and has built-in metadata filtering,
  but it costs dual writes, eventual consistency, a second place to enforce tenant isolation, and
  another service.
- **Neon's `lakebase_vector` (`lakebase_ann` index).** Neon's own ANN index, built on pgvector's
  types and operators. Plain pgvector with HNSW is standard and portable to any Postgres, and is
  enough for now. Switching later is a migration that swaps the index, with no change to columns or
  queries.

## When we would revisit

- Retrieval latency or recall misses targets after tuning `ef_search` and iterative scans.
- The chunk table grows past what one Neon compute serves comfortably.
- We need search features Postgres doesn't offer well (if we add keyword search, Postgres full-text
  search or Neon's BM25 is the first thing to try).
