# ADR 0005: Embeddings through AI Gateway, filtered HNSW search, and a retrieval eval

- Status: Accepted
- Date: 2026-10-26

## Context

Every chunk needs an embedding (ADR 0003 stores it in `chunk.embedding`, ADR 0004 decides the
chunks), and a question needs to find the closest chunks of **one user's** ready documents. Four
choices follow:

1. How the app calls an embedding model (provider, SDK, credentials).
2. Which model.
3. How a vector search stays both fast (the HNSW index) and correct when it's filtered to one
   user, which approximate indexes are bad at.
4. How we know whether a change to the model, the chunking or the query made answers better or
   worse.

## Decision

### 1. Vercel AI Gateway through the AI SDK (v7)

All model calls go through `createGateway()` from `ai` (`src/server/ai/models.ts`), with models
named `provider/model`.

- **One credential and one bill for every provider.** PR 6 adds a chat model; trying another
  provider's model (for answers or embeddings) is a string change, not a new SDK, key and invoice.
  The gateway also gives us usage and spend per model, retries across providers' regions, and
  fallbacks (`openai/text-embedding-3-small` is also served by Azure).
- **No key on Vercel.** On a Vercel deployment the gateway authenticates with the project's OIDC
  token, which Vercel issues and rotates. `AI_GATEWAY_API_KEY` is therefore optional in
  `src/lib/env.ts`. Locally, set it: the OIDC token that `vercel env pull` writes expires after 12
  hours. A key, when present, always wins over OIDC, even an invalid one, so don't set a stale key
  in Vercel's environment variables.
- **Paid credits are required for this model.** On the free tier the gateway answers
  `403 RestrictedModelsError` ("Free tier users do not have access to this model") for
  `openai/text-embedding-3-small`. The team needs AI Gateway credits (or BYOK) before indexing
  works, locally or deployed.
- The AI SDK splits `embedMany` calls only by count (2048 per call for the gateway). We batch
  ourselves by count and tokens (100 texts, 50k tokens) because OpenAI also caps a request at about
  300k tokens, and smaller batches make a retry cheap (`src/server/ai/embed.ts`).

Every embedding call writes an `ai_usage` row (user, kind `embed-index` or `embed-query`, model,
tokens) after it returns, outside any transaction, so tokens spent on a document that later fails
are still counted. Nothing reads it yet; it's there for per-user rate limits and cost reports.

### 2. `openai/text-embedding-3-small` (1536 dimensions)

- **Cheap.** $0.02 per million tokens: indexing a 100-page document (~60k tokens) costs about a
  tenth of a cent, and a query costs nothing worth counting.
- **Matches what we built.** ADR 0003 sized the column at 1536, and ADR 0004's chunk sizes are in
  cl100k tokens, this model's tokenizer, so our counts are exact (we also use them as the usage
  figure when a provider doesn't report one).
- **Good enough to measure first.** `text-embedding-3-large` (3072 dimensions) and newer models
  (Voyage, Gemini, Cohere) may retrieve better. The eval below is how we'd decide, not memory or
  leaderboards. Switching means a migration for the column and index, and re-embedding every
  chunk (`pnpm db:backfill-embeddings` after clearing the column); `EMBEDDING_MODEL_DIMENSIONS`
  and its unit test stop the constant and the model from drifting apart.

Indexing embeds every chunk **before** the transaction that stores the pages and chunks, so the
transaction only holds locks for the inserts, and a document is only `ready` when every chunk has
a vector (`chunk.embedding` is `NOT NULL` again from migration 0004). While embedding, the Library
shows "Almost ready".

### 3. Filtering: HNSW with pgvector 0.8 iterative scans

`searchByEmbedding` (`src/server/ai/retrieve.ts`) orders the user's chunks by cosine distance
(`<=>`, the HNSW index's `vector_cosine_ops`), joined to the document for its name and status:

```sql
set local hnsw.iterative_scan = relaxed_order;   -- inside the query's own transaction

with nearest as materialized (
  select …, chunk.embedding <=> $query as distance
  from chunk join document on document.id = chunk.document_id and document.user_id = $user
  where chunk.user_id = $user and document.status = 'ready' [and chunk.document_id in (…)]
  order by distance
  limit 5
)
select * from nearest order by distance + 0;
```

**The problem.** HNSW applies `WHERE` filters _after_ the index scan. With the default
`hnsw.ef_search = 40`, the index produces about 40 candidates from the whole table (every user),
and Postgres then drops the ones that aren't this user's or aren't ready. A user who owns 3% of the
chunks gets about one row, not five, and nothing tells you the result was cut short. The join to
`document` (ready only) filters after the scan too.

**What we measured** (Neon dev branch, Postgres 18.6, pgvector 0.8.6, 1,030 chunks of random
vectors, the user owning 30 of them, the planner pushed onto the HNSW index with
`enable_sort = off` and `hnsw.ef_search = 10`):

| `hnsw.iterative_scan` | rows returned for `limit 5` |
| --------------------- | --------------------------- |
| `off` (the default)   | 0                           |
| `relaxed_order`       | 5                           |

`src/server/ai/retrieve.integration.test.ts` reproduces this and fails if the search ever comes
back short on the HNSW path.

**The choice.** pgvector 0.8's iterative index scans keep scanning the index until enough rows pass
the filters, up to `hnsw.max_scan_tuples` (20,000 by default).

- `relaxed_order` rather than `strict_order`: relaxed has better recall, at the cost of rows coming
  back slightly out of distance order. The `materialized` CTE takes the top rows, and the outer
  `order by distance + 0` sorts them exactly. The `+ 0` stops Postgres 17+ from merging the two
  sorts.
- `set local`, inside a transaction: the setting lasts only for that transaction, which is the
  only safe way through Neon's pooled connection (PgBouncer in transaction mode). A plain `set`
  would change the setting for whichever client gets that server connection next.
- **The planner may not use HNSW at all**, and that's fine. With today's data, the plan reads the
  user's rows through the `chunk.user_id` B-tree index and sorts them exactly (we saw this with
  150 of 3,150 chunks). That is exact search, and fast while a user has at most 20 documents. As
  tables grow, the planner switches to HNSW for users whose rows are a large share, and iterative
  scans keep that path complete.

**Rejected:**

- _Raising `ef_search` alone._ It makes short results less likely, not impossible, and costs every
  query, including unfiltered ones.
- _A partial index per user, or partitioning by user._ It doesn't scale to many users, and the
  B-tree path already gives exact results for small users.
- _Always exact search (no HNSW)._ Simplest and exact, but cost grows with each user's chunk count.
  We may revisit it if the limit on documents per user stays at 20.

### 4. Measuring changes: the retrieval eval

`pnpm eval:retrieval` (`tests/evals/retrieval.ts`) is how we'll judge any change to the model,
chunking, query or filtering:

- Two generated fixture PDFs (a tenancy agreement and an employment contract, six dense pages each,
  `tests/evals/fixtures/make-fixtures.mjs`) are indexed through the real pipeline (extract, chunk,
  embed) for a dedicated eval user.
- 15 questions (`tests/evals/retrieval.json`): direct, paraphrased, two whose answer straddles a
  chunk boundary, and one the documents can't answer. A passage is right if it's from the expected
  document and page and contains a short exact quote.
- It prints **hit@1, hit@3, hit@5 and MRR** over the 14 answerable questions, a table of what
  wasn't ranked first, and the similarity floor numbers (below). Each run is saved to
  `tests/evals/results/retrieval-<date>.json` with the model, chunk settings and git commit, so
  runs can be compared.
- It costs a fraction of a cent but needs gateway credentials, so it isn't in CI. A free unit test
  (`tests/evals/retrieval-cases.test.ts`) does run in CI: it checks every question against the
  fixtures and the chunker, so a change that breaks a question fails there instead of quietly
  lowering the score.

**The similarity floor.** Vector search always returns its nearest five, however unrelated. `/chat`
hides passages below `MIN_SIMILARITY` (`src/server/ai/models.ts`) and shows "Nothing in your
documents matches that" when none pass. The floor is applied by `findPassages`, not by default in
`searchPassages`, so the eval measures raw ranking. The eval prints the best score of the
no-answer question and the lowest score of a right passage. The floor belongs between them, and
the eval warns when a right passage falls below it.

| Run       | hit@1                               | hit@3 | hit@5 | MRR | best no-answer | lowest right | floor          |
| --------- | ----------------------------------- | ----- | ----- | --- | -------------- | ------------ | -------------- |
| first run | _pending: needs AI Gateway credits_ |       |       |     |                |              | 0.25 (initial) |

## Consequences

- Indexing needs the gateway: a failed embedding call (after three retries per batch) fails the
  document with the generic message, and the user can retry it.
- Any model or chunking change gets an eval run before and after, with both results files
  committed.
- `ai_usage` grows by about one row per 100 chunks indexed and one per question. It needs a
  retention policy once it's used for rate limits.
- Answers in PR 6 reuse `searchPassages` and the floor, and `SourceCard` for the Sources panel.
