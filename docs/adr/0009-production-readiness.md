# ADR 0009: Production readiness: test doubles, Docker and observability

- Status: Accepted
- Date: 2026-11-08

## Context

Before sign-ups open (`docs/launch-checklist.md`), PR 9b closes four gaps:

1. Running DocChat needed Node, pnpm and a Neon branch. A contributor should get a working app
   from one command.
2. The end-to-end tests couldn't run in CI. The signed-in flows need a model (the Gemini free
   tier allows 20 requests a day for the whole project) and a Blob store (CI has no token, a
   token wouldn't reach fork PRs, and every run would leave files behind).
3. Errors in production were visible only in Vercel's logs, as free text.
4. There was no written plan for switching to the paid models and opening sign-ups.

## Decision

### Test doubles: fake AI providers and a local file store

`EMBEDDING_PROVIDER=fake`, `CHAT_PROVIDER=fake` and `STORAGE_DRIVER=local` are configured like
the real providers, so nothing around them changes: pacing, `ai_usage` rows, the daily limit,
citation filtering, tool approval and the upload checks all run as in production.

- **Fake embeddings** (`src/server/ai/fake.ts`): words, minus stop words, lightly stemmed,
  feature-hashed into 1536 signed dimensions and normalised. Offline and deterministic. Texts
  that share words score high; texts that share none score about 0. `minSimilarity` is 0.05, and
  `fake.test.ts` checks it against the retrieval eval: every direct question finds its passage
  in the top 3, and an off-topic question scores below the floor.
- **Fake chat model**: the AI SDK's `MockLanguageModelV4` (`ai/test`). The answer is the
  sentence sharing the most words with the question, with its `[n]` marker and a citations
  block that quotes it word for word. With no match, it answers "Your documents don't say
  anything about that." When the agent's tools are offered, it calls `proposeTasks` with one
  task per must/should sentence ("should" makes it optional), and never sets a date. Rewrite
  returns the follow-up as is; judge compares words. It's not a model, so it can't stand in for
  the evals: they still need real providers.
- **Local file store** (`src/server/storage/local.ts`): files on disk, same paths as Blob.
  `src/server/blob.ts` dispatches to it, so callers don't change. Browsers can't upload to it
  directly, so `PUT /api/documents/upload/local` takes the file. It runs the token route's
  checks (the caller's folder, type, size, upload rate limit), never overwrites, and is a 404
  with any other driver. `registerDocument` checks the stored bytes as before.

**Guard.** Test doubles are allowed only when `NODE_ENV` is `test` (Vitest) or `CI` is set, and
never when `VERCEL` is set (Vercel builds set `CI=1`). Env validation rejects them otherwise.
Separately, `src/instrumentation.ts` refuses to start the server (`assertTestDoublesAllowed`), so
a skipped validation can't let them through. Both have tests.

A real test Blob store was the alternative. It would test Blob itself, but it means one more
secret, no runs on fork PRs, and cleanup. `signed-in.spec.ts` still uploads to real Blob when
run locally.

### End-to-end tests in CI

The `e2e` job runs in parallel with `ci`. It uses a `pgvector/pgvector:0.8.6-pg18` service (the
same Postgres major and pgvector version as Neon), migrations, a production build and Playwright
against `pnpm start`, so the production CSP applies. Clerk's development instance provides the
sign-in, with testing tokens (`@clerk/testing`). Global setup creates the e2e user (a
`+clerk_test` address) through the Backend API if it's missing, and a setup project saves its
signed-in state. The flows run serially as one user; titles carry a run id, so reruns against
the same account work. On failure, the report and traces upload as an artifact.

### Docker

`Dockerfile`: dependencies, a standalone build (`output: "standalone"` only when
`BUILD_STANDALONE=1`, so Vercel builds are unchanged), a `migrate` target, and a runner on
`node:24-alpine` as uid 1001 with a `HEALTHCHECK` on `/api/health`. The build needs the public
Clerk key and the CSP, so `.env.local` is mounted as a BuildKit secret and never stored in a
layer. `docker-compose.yml` adds Postgres with pgvector and runs the migrations before the app.
Clerk, Blob and the AI provider stay external.

`/api/health` pings the database (`select 1`, 3 s timeout). It answers `{"status":"ok"}` or a
503 `{"status":"error"}`, with no versions, hosts or error text.

### Observability

- **Sentry** (`@sentry/nextjs` 11), only with `SENTRY_DSN`, for errors only. Tracing is off:
  spans would carry storage URLs, which include file names. Replay and feedback are off too.
  Sentry 11's `dataCollection` turns off user info, cookies, headers, bodies, query strings, AI
  and MCP inputs and outputs, query data and stack variables. The integrations that record
  console output, AI SDK prompts, Zod issues and extra error fields are removed. `beforeSend`
  keeps an allowlist: the Clerk user id, request method and path, a few runtime contexts, and
  scrubbed messages (emails, storage paths, quoted text and long tails become placeholders).
  Breadcrumbs are navigations only. Reports go through our origin (`/monitoring`, the tunnel
  route in handler mode), so the CSP stays as it is and ad blockers don't drop them. The browser
  loads the SDK only when a DSN was set at build. Source maps upload only with
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`.
- **Structured logs** (`src/server/log.ts`): a typed event map with fixed fields (ids, counts,
  durations, model, error kind), so free text can't be logged by accident.
- **Vercel Web Analytics and Speed Insights**: cookie-free, same-origin, rendered only on Vercel.

## Consequences

- PRs run the signed-in flows without spending AI quota. What the fakes can't catch, real model
  behaviour, stays with the evals, which still run by hand before model or prompt changes.
- The e2e job depends on four repository secrets for Clerk's development instance. Forks skip
  it with a notice.
- The upload path in CI is our own route, not Blob's. A Blob-side regression shows up only in
  local runs of `signed-in.spec.ts`.
- `docker compose up` gives a working app from a clean clone plus `.env.local`. The image isn't
  published anywhere yet; deployment stays on Vercel.
- Sentry sees less than it could (no spans, no request bodies, scrubbed messages). Debugging a
  report may need the structured logs or a reproduction.

## Amendment (2026-11-10)

The Gemini project moved to the paid tier (ADR 0005, amendment), so launch no longer waits for
the AI Gateway: `docs/launch-checklist.md` now launches on Gemini, and the gateway is an
optional later step. The test doubles stay: CI has no AI key, every real call now costs money,
and the fakes keep the e2e job deterministic.
