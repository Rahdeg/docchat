# ADR 0005: Embedding providers, filtered HNSW search, and a retrieval eval

- Status: Accepted
- Date: 2026-10-27

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

### 1. Two providers behind one switch: Gemini's free tier now, AI Gateway before launch

`EMBEDDING_PROVIDER` (`src/lib/env.ts`) picks the provider; everything else reads
`embeddingConfig` from `src/server/ai/models.ts`:

| `EMBEDDING_PROVIDER` | Model (stored as `chunk.embedding_model`) | Through                     | For                                       |
| -------------------- | ----------------------------------------- | --------------------------- | ----------------------------------------- |
| `google` (default)   | `google/gemini-embedding-001` at 1536     | `@ai-sdk/google`, free tier | development, **fictional documents only** |
| `gateway`            | `openai/text-embedding-3-small` (1536)    | Vercel AI Gateway           | production, before launch                 |

- **AI Gateway is where we're going.** One credential and one bill for every provider (PR 6 adds
  a chat model through it), usage and spend per model, and provider fallbacks
  (`openai/text-embedding-3-small` is also served by Azure). On Vercel it authenticates with the
  project's OIDC token, so production needs no `AI_GATEWAY_API_KEY`. Locally a key is needed (the
  pulled OIDC token expires after 12 hours). A key always wins over OIDC, even an invalid one.
- **Why not yet.** The gateway's free tier refuses this model (`403 RestrictedModelsError`, "Free
  tier users do not have access to this model"), and paid credits start at $20. Until then,
  embeddings come from the Gemini API's free tier.
- **The free tier is for development with fictional documents only.** Google's terms allow
  free-tier content to be used to improve its products, and its limits are low. Use it with the
  seed data, the eval fixtures and sample uploads, never real users' documents. Production
  switches to `gateway` before launch: set `EMBEDDING_PROVIDER=gateway`, then
  `pnpm db:backfill-embeddings` and a fresh eval run (the floor below is per model).
- **Gemini settings.** `gemini-embedding-001` outputs 3072 dimensions; we request
  `outputDimensionality: 1536` so the column, index and `EMBEDDING_DIMENSIONS` stay the same.
  Gemini only normalises 3072-dimension output, but cosine distance doesn't depend on length.
  Chunks are embedded with task type `RETRIEVAL_DOCUMENT` and questions with `RETRIEVAL_QUERY`,
  which the provider supports and Google recommends for asymmetric search. Gemini doesn't report
  token usage, so `ai_usage` records our cl100k count as an estimate.
- **Rate limits.** Google doesn't publish free-tier numbers (they're per project in AI Studio);
  roughly 100 requests a minute. Each provider has its own limits in `embeddingConfig.limits`.
  Gemini gets at most 20 texts or 10k tokens per request, one request at a time, at least 700 ms
  apart across the whole process. The gateway gets 100 texts and 50k tokens (OpenAI caps a
  request at about 300k), three at a time. The SDK's own retries (2 s, 4 s, 8 s) are too short for
  a per-minute quota, so they're off and `callModel` (`src/server/ai/embed.ts`) retries: on a 429
  it waits as long as the provider asks (`retry-after`, or Google's `retryDelay`), otherwise 5 s
  doubling up to a minute; other retryable errors get 1 s doubling. Gemini gets up to six
  retries, the gateway three.

Every embedding call writes an `ai_usage` row (user, kind `embed-index` or `embed-query`, model,
tokens) after it returns, outside any transaction, so tokens spent on a document that later fails
are still counted. Nothing reads it yet; it's there for per-user rate limits and cost reports.

### 2. Vectors from different models are never mixed

A vector is only comparable with vectors from the same model. Each chunk stores the model that
embedded it (`chunk.embedding_model`, migration 0004), and search only considers chunks whose
model is the current `EMBEDDING_MODEL`. After switching providers, existing documents drop out of
search until `pnpm db:backfill-embeddings` re-embeds them. The backfill picks up every chunk of a
ready document whose embedding is missing or came from another model, and only updates rows that
still need it, so it's safe to re-run. Migration 0005 then makes both columns `NOT NULL`. It fails
while any chunk still needs an embedding. drizzle-kit applies all pending migrations in one
transaction, so on a branch that has pre-PR chunks and is behind 0004, that failure rolls back
0003 and 0004 too, and the backfill (which needs 0004's column) can't run first. On such a branch
(Neon `main`), remove the pre-PR documents, then migrate. The backfill route (migrate to 0004,
backfill, migrate to 0005) only works on a branch already at 0004, as `dev` was.

Indexing embeds every chunk **before** the transaction that stores the pages and chunks, so the
transaction only holds locks for the inserts, and a document is only `ready` when every chunk has
a vector. While embedding, the Library shows "Almost ready".

Switching models (or providers) means re-embedding every chunk. `EMBEDDING_CONFIGS` lists each
model's output size, and a unit test checks each against `EMBEDDING_DIMENSIONS`.

### 3. Filtering: HNSW with pgvector 0.8 iterative scans

`searchByEmbedding` (`src/server/ai/retrieve.ts`) orders the user's chunks by cosine distance
(`<=>`, the HNSW index's `vector_cosine_ops`), joined to the document for its name and status:

```sql
set local hnsw.iterative_scan = relaxed_order;   -- inside the query's own transaction

with nearest as materialized (
  select …, chunk.embedding <=> $query as distance
  from chunk join document on document.id = chunk.document_id and document.user_id = $user
  where chunk.user_id = $user and chunk.embedding_model = $model
    and document.status = 'ready' [and chunk.document_id in (…)]
  order by distance
  limit 5
)
select * from nearest order by distance + 0;
```

**The problem.** HNSW applies `WHERE` filters _after_ the index scan. With the default
`hnsw.ef_search = 40`, the index produces about 40 candidates from the whole table (every user),
and Postgres then drops the ones that aren't this user's, aren't from the current model or aren't
ready. A user who owns 3% of the chunks gets about one row, not five, and nothing tells you the
result was cut short.

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
  all fictional, `tests/evals/fixtures/make-fixtures.mjs`) are indexed through the real pipeline
  (extract, chunk, embed) for a dedicated eval user.
- 15 questions (`tests/evals/retrieval.json`): direct, paraphrased, two whose answer straddles a
  chunk boundary, and one the documents can't answer. A passage is right if it's from the expected
  document and page and contains a short exact quote. Three off-topic probes ("a recipe for banana
  bread"…) aren't scored; they show what an unrelated question scores.
- It prints **hit@1, hit@3, hit@5 and MRR** over the 14 answerable questions, a table of what
  wasn't ranked first, and the similarity floor numbers (below). Each run is saved to
  `tests/evals/results/retrieval-<date>.json` with the model, chunk settings and git commit, so
  runs can be compared.
- It costs nothing on Gemini's free tier and a fraction of a cent on the gateway, but needs a key,
  so it isn't in CI. A free unit test (`tests/evals/retrieval-cases.test.ts`) does run in CI: it
  checks every question against the fixtures and the chunker, so a change that breaks a question
  fails there instead of quietly lowering the score.

**The similarity floor.** Vector search always returns its nearest five, however unrelated. `/chat`
hides passages below `MIN_SIMILARITY` and shows "Nothing in your documents matches that" when none
pass. Scores depend on the model, so each provider config has its own floor. It's applied by
`findPassages`, not by default in `searchPassages`, so the eval measures raw ranking. The eval
suggests a floor halfway between the lowest right passage and the highest score that should be
hidden: the no-answer question's if it's lower, otherwise the off-topic probes'.

**First run** (2026-10-27, commit `283cb90`, `google/gemini-embedding-001` at 1536 dimensions,
500-token chunks with 75 tokens of overlap):

| hit@1 | hit@3 | hit@5 | MRR   | lowest right | best no-answer | best off-topic | floor    |
| ----- | ----- | ----- | ----- | ------------ | -------------- | -------------- | -------- |
| 92.9% | 92.9% | 100%  | 0.946 | 0.599        | 0.640          | 0.503          | **0.55** |

- Gemini's cosine scores sit in a narrow, high band: right passages 0.60 to 0.74, and even a
  question about baking scores 0.50.
- The no-answer question ("Do I get a company car or a car allowance?") is on-topic for the
  employment contract and scores 0.640, above the weakest right passage, so **no floor can hide
  it**. Saying "the documents don't say" is the answering model's job (PR 6), not the floor's.
- 0.55 hides unrelated questions and keeps every right passage. It is set for Gemini only; the
  gateway's 0.25 is a placeholder until the eval runs on it.
- The one question not ranked first, "Am I allowed to work from home?" (rank 4), has its answer on
  page 1 of the contract, which is a single chunk covering parties, duties, place of work and
  equipment. The hybrid-working clause is a small part of that vector. Smaller chunks, or putting
  clause headings into the embedded text, are the first things to try, measured with this eval.

## Consequences

- Indexing needs a working embedding provider: a failed call (after its retries) fails the
  document with the generic message, and the user can retry it.
- Switching providers is one env change plus a backfill and an eval run. Search ignores chunks
  from the old model until the backfill re-embeds them.
- Any model or chunking change gets an eval run before and after, with both results files
  committed.
- `ai_usage` grows by about one row per request and one per question. It needs a retention policy
  once it's used for rate limits. Its token counts for Gemini are estimates.
- Answers in PR 6 reuse `searchPassages` and the floor, and `SourceCard` for the Sources panel.
