PR 5: embeddings, semantic search and a retrieval eval. New branch from main: feat/retrieval.

Before writing code, show me your plan as a checklist and wait for my approval. Use the ai-sdk skill (read the installed AI SDK's docs, not memory), the Neon skills and the Next.js skills. Check pgvector 0.8 docs for filtered HNSW queries.

GOAL
Every chunk gets an embedding during indexing. A signed-in user types a question on /chat and sees the 5 most relevant passages from their own documents, with document name and page. No LLM answers yet (PR 6). A repeatable retrieval eval prints a score I can track over time.

AI SETUP

1. Use Vercel AI Gateway through AI SDK v7. Replace AI_API_KEY with AI_GATEWAY_API_KEY in env.ts and .env.example (check whether it's needed on Vercel deployments or OIDC covers it, and document that).
2. src/server/ai/models.ts: EMBEDDING_MODEL = 'openai/text-embedding-3-small'. Add a unit test asserting its dimensions match EMBEDDING_DIMENSIONS (1536).
3. Log usage: a small ai_usage table (userId, kind: 'embed-index' | 'embed-query', model, tokens, createdAt), written after every embedding call. We'll use it for rate limits and cost tracking later.

INDEXING 4. After chunking, embed chunks with embedMany in sensible batches with retries. Do the network calls BEFORE the database transaction, then insert pages, chunks and embeddings in one transaction as now. 5. Status copy while embedding: after "Reading page X of Y", show "Almost ready" until embeddings are stored. A document is only Ready when every chunk has an embedding. 6. Backfill: a script (pnpm db:backfill-embeddings) that embeds existing ready documents with missing embeddings, safe to re-run. Update the seed so sample chunks get real embeddings. Once backfilled, make chunk.embedding NOT NULL with a migration.

SEARCH 7. src/server/ai/retrieve.ts: searchPassages({ userId, query, documentIds?, limit = 5 }). Embed the query, then order by cosine distance using the HNSW index, filtered by userId and ready documents, joined with the document name. Return documentId, name, page, content, startOffset, endOffset and similarity (1 - distance). Make sure the userId filter doesn't silently cut results short with HNSW (pgvector 0.8 iterative scans) and explain your choice in the ADR. 8. An authed Server Action findPassages({ query, documentIds? }) with Zod validation (query 3 to 500 characters) that calls searchPassages.

UI (/chat, a temporary "find passages" mode) 9. Enable the composer. Submitting shows up to 5 source cards in the style of our chat design's Sources panel and the Library sheets: document name in serif, page number, the passage text (serif) with the best-matching sentence highlighted with bg-highlight if easy, otherwise the whole passage. Each card links to Open (the authed file route). 10. A short note above the results: "Answers are coming soon. For now, these are the passages DocChat would use." Empty state when nothing matches: "Nothing in your documents matches that. Try different words, or add a document." A "Show match scores" toggle (off by default) shows similarity as a percentage, which helps me debug.

EVAL (the important part) 11. Create two realistic, fictional fixture documents in tests/evals/fixtures (a multi-page tenancy agreement PDF and an employment contract PDF; generate them with a script so they're reproducible). I have also put hand-made samples in tests/fixtures/samples/ (sample-tenancy-agreement.pdf, sample-employment-contract.pdf, sample-course-syllabus.md, sample-meeting-notes.txt); you may use those instead of generating new ones if that's simpler. 12. tests/evals/retrieval.json: 15 questions about the fixtures, each with the expected document, expected page and a short exact quote that must appear in the right passage. Include a few tricky ones: paraphrased wording, a question whose answer is split across a chunk boundary, and one with no answer in the documents. 13. pnpm eval:retrieval: index the fixtures for a dedicated eval userId (clean up first), run every question, and print hit@1, hit@5 and MRR, plus a table of misses. Save results to tests/evals/results/retrieval-<date>.json so I can compare runs. Not in CI (it costs money), documented in the README.

TESTS 14. Integration test (skipped without DATABASE_URL and AI_GATEWAY_API_KEY): user B never gets user A's passages, even with an identical document and identical query. Unit tests for findPassages validation and auth, and for the embedding batch logic (mock the model).

ALSO 15. docs/adr/0005-embeddings-and-search.md: why AI Gateway, why text-embedding-3-small, the filtering approach, and how we'll measure changes (the eval). 16. Update CLAUDE.md and README (AI Gateway setup, backfill and eval commands).

DONE MEANS
typecheck, lint, format:check, test and build pass; I upload a document, ask a question on /chat, and see the right passage in the top 3; pnpm eval:retrieval prints scores. Commit in logical steps, push, open a PR with test steps and the first eval scores in the description. Finish with the usual summary, including anything you couldn't verify.
