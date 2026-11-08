# DocChat

Users upload documents and ask questions; answers come back with cited sources (RAG). When they
ask for tasks, an agent proposes tasks from their documents, each linked to its clause, and saves
them only when the user approves (`docs/adr/0007`). The Tasks page holds those and the user's own.
Users can also connect their own AI app over MCP (`/mcp`, Clerk OAuth) to search their documents
and manage their tasks with that app's model (`docs/adr/0008`). Security notes, the authorization
table and the Clerk dashboard steps are in `docs/security.md`.

Next.js-specific agent rules live in AGENTS.md (generated and kept up to date by `next dev`). Read it;
don't duplicate or hand-edit the managed block:

@AGENTS.md

## Stack

- Next.js 16 (App Router, `src/`, Turbopack, Cache Components on), React 19, TypeScript strict
- Tailwind CSS v4 (CSS-first config in `src/app/globals.css`, no `tailwind.config`)
- shadcn/ui (`base-nova` style, Base UI primitives), Geist + Geist Mono via the `geist` package,
  Newsreader (`next/font/google`, `font-serif`) for document names and document text only
- Zod 4 + `@t3-oss/env-nextjs` for env validation
- Neon Postgres (project `docchat`, `aws-eu-central-1`) + Drizzle ORM + pgvector, via
  node-postgres (`pg`)
- Clerk (`@clerk/nextjs` 7) for auth, themed with the shadcn theme from `@clerk/ui`
- Vercel Blob (private store) for uploaded files; `unpdf` for PDF text; `gpt-tokenizer` (cl100k)
  for chunk sizes
- Vercel AI SDK v7 (`ai`). Embeddings (1536 dimensions, `docs/adr/0005`) from
  `EMBEDDING_PROVIDER`: `google` (default; `@ai-sdk/google`, `gemini-embedding-001`, free tier,
  development only) or `gateway` (Vercel AI Gateway, `openai/text-embedding-3-small`, production).
  Chat from `CHAT_PROVIDER`: `google` (default; `gemini-3.6-flash`, free tier, development only) or
  `gateway` (`anthropic/claude-sonnet-5.5`, production); `@ai-sdk/react` (`useChat`) in the
  browser (`docs/adr/0006`). Tool calling with the SDK's built-in approval (`docs/adr/0007`)
- Data flow: Server Components for reads, Server Actions for writes (no tRPC, see
  `docs/adr/0001`). Route handlers only where an action can't work: Blob upload tokens and
  serving stored files (`src/app/api/documents/`), and streaming answers (`POST /api/chat`)
- MCP: `mcp-handler` 2 (MCP SDK v2, stateless Streamable HTTP, no SSE), `@clerk/backend` for OAuth
  token checks, `@clerk/mcp-tools` for the `.well-known` metadata routes
- Tooling: pnpm (pinned via `packageManager`), ESLint 9 flat config, Prettier, lefthook, Vitest,
  Playwright (e2e, `@clerk/testing` for signed-in specs), Dependabot

## Commands

pnpm is pinned per project and not installed globally. Run it through Corepack (`corepack pnpm <cmd>`),
or run `corepack enable pnpm` once if you want a bare `pnpm`.

| Command                       | What it does                                        |
| ----------------------------- | --------------------------------------------------- |
| `pnpm dev`                    | Dev server (Turbopack)                              |
| `pnpm build`                  | Eval summary, then production build (validates env) |
| `pnpm start`                  | Serve the production build                          |
| `pnpm lint`                   | ESLint (`next lint` no longer exists in Next 16)    |
| `pnpm typecheck`              | `next typegen` then `tsc --noEmit`                  |
| `pnpm format`                 | Prettier write                                      |
| `pnpm format:check`           | Prettier check (CI)                                 |
| `pnpm test`                   | Vitest, single run                                  |
| `pnpm test:e2e`               | Playwright e2e (local only, not in CI yet)          |
| `pnpm db:generate`            | Generate a SQL migration from the schema            |
| `pnpm db:migrate`             | Apply pending migrations (direct connection)        |
| `pnpm db:studio`              | Drizzle Studio against `DATABASE_URL_UNPOOLED`      |
| `pnpm db:seed`                | Reset and insert sample data (development only)     |
| `pnpm db:backfill-embeddings` | (Re-)embed chunks missing a current-model vector    |
| `pnpm eval:retrieval`         | Retrieval eval: hit@k, MRR, floor calibration       |
| `pnpm eval:answers`           | Answer eval: citations, grounding, honesty          |
| `pnpm eval:agent`             | Agent eval: task recall, precision, sources         |
| `pnpm eval:injection`         | Prompt-injection eval: hostile documents            |
| `pnpm eval:summary`           | Write `src/content/eval-summary.json` from results  |

`pnpm db:seed --user user_…` (or `SEED_USER_ID=user_…`) seeds a real Clerk user so the data shows
up after signing in. It deletes that user's existing rows first.

Before you call a change done: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.
CI also runs `pnpm audit --prod --audit-level=high`.

## Folder conventions

```
src/app/(public)/      the landing page and /how-we-test (static, no Clerk)
src/app/(auth)/        sign-in / sign-up routes (Clerk)
src/app/(app)/         authenticated app routes
src/components/ui/     shadcn-generated. Do not hand-edit.
src/components/        shared app components built on ui/
src/content/           site facts (site.ts: footer name and links) and the build-time eval summary
src/features/<name>/   feature modules: documents, chat, tasks, settings, public (components, actions, schemas,
                       queries.ts for user-scoped reads, mutations.ts for writes)
src/server/auth.ts     requireUserId() for Server Components
src/server/db/         Drizzle client (index.ts) and schema/ (one file per area)
src/server/ai/         AI SDK setup, chunking, retrieval, prompts, tools (server-only)
src/server/ingest/     text extraction and the indexing pipeline (server-only)
src/server/mcp/        MCP server: token check (auth.ts), tools, untrusted-content wrapping
src/server/account.ts  deleting a user's rows and files (the Clerk webhook)
src/server/rate-limit.ts  sliding-window rate limits in Postgres (numbers in src/lib/rate-limits.ts)
src/server/blob.ts     the only place that calls the Vercel Blob SDK
src/lib/               utilities (cn, env, format, routes, app-url, security-headers, rate-limits)
                       and authedAction() (action.ts)
src/proxy.ts           clerkMiddleware with optimistic redirects (Next 16 replaces middleware.ts)
docs/adr/              architecture decision records
docs/design/           HTML design mockups per area; match them when building that UI
drizzle/               generated SQL migrations and snapshots (committed)
scripts/               standalone scripts run with tsx (seed, backfill-embeddings)
tests/e2e/             Playwright end-to-end tests (`*.spec.ts`); signed-in ones need E2E_CLERK_USER_EMAIL
tests/fixtures/        test files (PDFs), the PDF writer (pdf.mjs) and the script that uses it
tests/evals/           retrieval, answer, agent and injection evals: fixtures, questions
                       (retrieval.json), scenarios (agent.json, injection.json), runners, results/
```

Unit tests sit next to the code as `*.test.ts(x)`. Component tests that need a DOM start with
`// @vitest-environment happy-dom` and use `@testing-library/react`. Playwright tests live in `tests/e2e/` and run
against `pnpm dev` (reused if it's already running) or `E2E_BASE_URL`.

## Rules

- Every file in `src/server/` starts with `import "server-only";`.
- Validate with Zod at every boundary: env, Server Action input, route handler bodies, AI tool
  inputs/outputs, external API responses. Never trust `FormData` or JSON unparsed.
- Never hand-edit `src/components/ui/` or `src/hooks/use-mobile.ts`. They belong to shadcn and
  are excluded from ESLint and Prettier. Change them with the shadcn CLI, or wrap them in
  `src/components/`.
- No `any` (ESLint enforces this). Use `unknown` and narrow it, or write a Zod schema.
- Prefix intentionally unused variables with `_`.
- Every query filters by `userId`. No unscoped reads or writes on user data.
- Read env through `env` from `@/lib/env`, never `process.env` directly. The exceptions are tooling
  that runs outside Next (`drizzle.config.ts`, `scripts/`, `vitest.config.mts`) and `NODE_ENV`.
- Before writing UI, check the installed skills (`shadcn`, `vercel-react-best-practices`) and the
  shadcn MCP server (`.mcp.json`) for an existing component or pattern.
- Before writing Next.js, AI SDK, Clerk or Neon code, read the matching skill in `.claude/skills/`.
- Use theme tokens, not raw colours: `bg-background` (the grey desk), `bg-card` (white paper),
  `text-secondary-text`, `bg-highlight` for quoted passages, and the status marks
  (`bg-status-ready`, `-reading`, `-problem`, `-neutral`, each with a `-foreground` text colour).
  shadcn controls fill with `bg-background`, so on a white surface add the `paper` utility (it
  sets `--background` to the card colour) rather than overriding the control's colours.
- `font-serif` (Newsreader) is only for document names and document text, plus the public
  pages' headings and metric numbers (as `docs/design/public` shows). All UI stays Geist; don't
  use Geist Mono for UI labels. Geist Mono is loaded only in the `(app)` layout.
- Suspense fallbacks are prerendered, so they can't use `Math.random()` or the current time. That
  rules out shadcn's `SidebarMenuSkeleton`; use `Skeleton` with fixed widths.
- Make small, focused commits with Conventional Commit messages (`feat:`, `fix:`, `chore:`,
  `docs:`, `refactor:`, `test:`, `ci:`). The pre-commit hook lints and formats staged files.

## Database rules (Neon + Drizzle)

- Neon branches: `main` (default) and `dev` for local work. `.env.local` points at `dev`.
- `DATABASE_URL` is the pooled (`-pooler`) string for the app. `DATABASE_URL_UNPOOLED` is the
  direct string; drizzle-kit uses it, since migrations can break through PgBouncer.
- Schema changes: edit `src/server/db/schema/`, run `pnpm db:generate`, read the SQL, then
  `pnpm db:migrate`. Commit the migration and its snapshot. Never use `drizzle-kit push`.
- `pnpm db:migrate` applies all pending migrations in one transaction: if one fails, the ones
  before it roll back too. A migration that needs a data backfill first (like 0005, embeddings
  `NOT NULL`) only works on branches where that backfill can run beforehand; on others, remove
  the old rows first.
- Anything Drizzle can't express (extensions) goes in a custom migration:
  `pnpm db:generate --custom --name=<name>`.
- Queries live in `src/features/<area>/queries.ts`, start with `import "server-only"`, take
  `userId` as their first argument and filter by it. Use the query builder; raw SQL is only for
  vector search.
- Every user-data table has a `user_id` column with an index. Child tables (`chunk`, `message`)
  copy it from their parent so they can be filtered without a join.
- Multi-row writes that must succeed together (a document's chunks) use `db.transaction`.
- `EMBEDDING_DIMENSIONS` in `src/server/ai/constants.ts` must match every embedding model's
  output (`EMBEDDING_CONFIGS` in `src/server/ai/models.ts`; a unit test checks them). Changing it
  needs a migration and re-embedding; a unit test fails if the migration is missing.
- Scripts and drizzle-kit run with `--conditions=react-server` so `server-only` imports resolve
  outside Next. The `db:*` scripts already do this.
- Integration tests (`*.integration.test.ts`) use `describe.skipIf(!process.env.DATABASE_URL)` and
  import database modules lazily. Tests that embed for real (anything that indexes or searches
  with a real query) also skip unless `hasEmbeddingKey` (`src/server/ai/models.ts`): the
  configured provider's key is set. CI has neither and sets `SKIP_ENV_VALIDATION`.

## Files and indexing rules (Vercel Blob)

- Files live in a **private** Blob store. Never send a raw Blob URL to the browser. Files are
  served only by `GET /api/documents/[id]/file`, which checks ownership and responds with
  `Cache-Control: private, no-cache`. Never cache private files on the CDN (`s-maxage`).
- Call Blob only through `src/server/blob.ts`. It passes `BLOB_READ_WRITE_TOKEN` explicitly;
  otherwise the SDK prefers OIDC, and the OIDC token in `.env.local` expires after a few hours.
- Browsers upload straight to Blob (functions cap request bodies at 4.5 MB):
  `POST /api/documents/upload` issues a token, then the client calls `registerDocument`. There is
  no upload-completed webhook (it can't reach localhost).
- Blob paths are `users/<userId>/<uuid>-<name>`. The server checks the userId segment against the
  session in both the token route and `registerDocument`.
- Limits live in `src/features/documents/upload-rules.ts`, shared by client and server: PDF, `.md`
  and `.txt`, 10 MB, 20 documents per user. The server checks the stored file's real size and its
  leading bytes, not the browser's claims.
- Indexing runs in `after()` from the Library page's Server Actions, so it gets that page's
  **`maxDuration` (300 s, `src/app/(app)/library/page.tsx`)**. Work that might take longer doesn't
  belong there. An `uploaded`/`indexing` document with no progress for 10 minutes shows as stuck
  ("Reading stopped"); keep `maxDuration` under that. A durable queue is a TODO (`docs/adr/0004`).
- `indexDocument` only claims documents in `uploaded`, and replaces a document's pages and chunks
  in one transaction. A retry puts the document back to `uploaded`; never insert chunks elsewhere.
- Chunks: ~500 tokens, ~15% overlap, whole sentences, never across pages. `startOffset` and
  `endOffset` index into `document_page.text`, and `text.slice(start, end) === content` must hold
  (`docs/adr/0004`). `chunk.embedding` and `chunk.embedding_model` are `NOT NULL`: chunks are
  embedded before the transaction that stores them, and a document is `ready` only when all of
  them are. While embedding, the Library shows "Almost ready".
- Regenerate the PDF fixtures with `node tests/fixtures/make-pdfs.mjs`.

## AI rules (AI SDK, Gemini free tier, AI Gateway)

- Read `.claude/skills/ai-sdk` and the installed docs in `node_modules/ai/docs/` (and
  `node_modules/@ai-sdk/google/docs/`) before writing AI SDK code; don't write it from memory.
- **The Gemini free tier (`EMBEDDING_PROVIDER=google`, the default) is for development with
  fictional documents only**: seed data, eval fixtures, sample uploads. Google may use free-tier
  content to improve its products. Never point it at real users' documents. Production switches
  to `EMBEDDING_PROVIDER=gateway` before launch (`docs/adr/0005`).
- Models and providers are configured only in `src/server/ai/models.ts`: `embeddingConfig` (model,
  task-type options, request limits, similarity floor) for the current provider, and the `gateway`
  instance for chat later. Keys come from `env`, never `process.env`. Don't add other provider
  packages.
- Keys: `GOOGLE_GENERATIVE_AI_API_KEY` for `google`. `AI_GATEWAY_API_KEY` for `gateway`, optional
  on Vercel (OIDC); a key always wins over OIDC, even an invalid one. The gateway needs paid
  credits for this model; its free tier answers 403.
- Embed only through `src/server/ai/embed.ts` (`embedChunks`, `embedQuery`). It batches within the
  provider's limits, spaces requests out (Gemini: one at a time, 700 ms apart), retries 429s as
  long as the provider asks, validates every vector's size, and writes an `ai_usage` row after
  each call. Don't call `embed`/`embedMany` directly.
- Every chunk stores `embedding_model`. Search only uses chunks from the current
  `EMBEDDING_MODEL`. After changing `EMBEDDING_PROVIDER`, run `pnpm db:backfill-embeddings` (it
  re-embeds every other-model chunk) and `pnpm eval:retrieval`, then set that provider's
  `minSimilarity`.
- Vector search lives in `src/server/ai/retrieve.ts`: raw SQL with
  `set local hnsw.iterative_scan = relaxed_order` inside its own transaction, so the user filter
  can't cut results short (`docs/adr/0005`). Never use a session-wide `set` (the pooled connection
  is shared).
- `searchPassages` has no similarity floor by default; callers that show results pass
  `MIN_SIMILARITY` (`findPassages` does), which is per model (Gemini 0.58, calibrated). The eval
  relies on the raw ranking.
- Before and after changing the embedding model, chunking or search, run `pnpm eval:retrieval`
  and commit both results files. If the fixtures or chunker change, `retrieval-cases.test.ts` says
  which questions need new pages or quotes.

## Chat rules (answers and citations, `docs/adr/0006`)

- Chat models live in `CHAT_CONFIGS` (`src/server/ai/models.ts`): `answer`, `rewrite` and
  `judge` per provider. `CHAT_ANSWER_MODEL` overrides the answer model on the same provider.
- **The Gemini free tier allows 20 requests a day per model for the whole project** (resets at
  midnight Pacific). Don't spend it casually: tests that call the chat model also need
  `LIVE_CHAT_TESTS=1`, and `pnpm eval:answers` needs about 17 answers (it resumes a run the
  quota stopped). To recheck a few questions, pass `--only=<ids>` to either eval.
- When the provider refuses for quota (429 / `RESOURCE_EXHAUSTED`, `isQuotaError`), the route
  keeps the question, saves no answer and sends `FREE_LIMIT_MESSAGE`. `CHAT_DAILY_LIMIT`
  defaults to 10 on `google` and 50 on `gateway`. A follow-up that reads as standalone
  (`readsStandalone`, `src/server/ai/follow-up.ts`) skips the rewrite call.
- Generate only through `src/server/ai/answer.ts` (`streamAnswer`, `rewriteQuery`,
  `answerQuestion`) and `judge.ts`. They pace and retry through `callChatModel`
  (`call-model.ts`) and write an `ai_usage` row per generation (`recordGeneration`: `chat`,
  `rewrite`, `judge`). The daily limit (`CHAT_DAILY_LIMIT`) counts `chat` rows since midnight UTC
  and is checked in the route before any model call.
- Document text goes to the model only through `answerMessages` / `formatSources`
  (`prompts.ts`): numbered `<source>` blocks in the latest user message, marked untrusted, with
  look-alike tags escaped. Never put document text in the system prompt.
- Citations: the model writes `[n]` markers and a trailing `<citations>` block of
  `{"source", "quote"}` lines. `CitationFilter` hides the block, renumbers chips by first
  appearance and drops markers to unretrieved sources while streaming; `resolveCitations` looks
  for each quote only in its own passage (`matchQuote`, 0.85 similarity) and highlights the whole
  passage when it isn't found. Don't render raw model text that skipped the filter.
- No passage above `MIN_SIMILARITY` means no model call: the route streams
  `noPassagesAnswer` ("Your documents don't say…").
- Messages are AI SDK UIMessages (`src/features/chat/message.ts`): answers carry
  `data-passages` (a copy of what was read) and `data-citations`. They're validated on load
  (`listMessages`), so changing a part's shape means migrating stored messages.
- The answer text renders through `parseAnswer` (`answer-markup.ts`): paragraphs, `- ` lists,
  `**bold**` and chips. Never render model output as HTML.
- `/chat` redirects to `/chat/<new uuid>`; the chat row is created by the first question
  (`ensureChat`). Keep one page per chat id so `useChat` keeps its state across `router.refresh()`.
- Before and after changing the chat model, the prompts or citation handling, run
  `pnpm eval:answers` and commit both results files.

## Tasks and agent rules (`docs/adr/0007`)

- The agent's tools are offered only when the user's own message asks for tasks
  (`asksForTasks`, `src/features/chat/task-request.ts`) or they click "Turn this into tasks"
  (which sends `TURN_INTO_TASKS`). Never decide from document text or the model's output. Plain
  questions run exactly as in PR 6, with no tools.
- Tools are built per request in `agentTools` (`src/server/ai/agent.ts`) with the session's
  `userId`; no tool input may carry a user id. `searchDocuments` stays within the documents the
  user chose.
- `proposeTasks` uses `toolApproval: "user-approval"` and has **no `execute`**. The agent's tasks
  are written only by `answerProposal` (`src/features/tasks/agent-tasks.ts`), from an approval
  request, in one transaction that locks the answer's row and records the decision. Don't add
  another write path, and don't rebuild approvals from browser-sent history.
- Proposed tasks go through `checkProposal` (`src/server/ai/proposal.ts`): source in this run's
  passages, quote matched with `matchQuote` (whole passage otherwise), dates only when a passage
  or the user states them or the due note counts from a stated date (`dueDateIsGrounded`). Never
  set a date the documents or the user didn't give.
- Agent runs: at most `AGENT_MAX_STEPS` (5) model calls, each a `chat` `ai_usage` row, so the
  daily limit counts calls. The reply to an approval is a fixed line, with no model call.
- Task offsets (`source_start_offset`, `source_end_offset`) index into the chunk's content. A
  re-read document's tasks lose the chunk link and keep the quote (TODO: re-link by quote).
- Before and after changing the agent prompt, tools or proposal checks, run `pnpm eval:agent`
  (about 6 to 12 of the free tier's 20 daily requests) and commit the results file.
- Task writes on the Tasks page are `authedAction`s in `src/features/tasks/actions.ts` and call
  `refresh()`, so the sidebar's open-task count follows. Undo re-inserts a deleted task through
  `restoreTask`, keeping links only to rows the user still owns.

## MCP and safety rules (`docs/adr/0008`, `docs/security.md`)

- The MCP server is `src/app/mcp/route.ts` (not `[transport]`: mcp-handler 2 has no SSE). Every
  request needs a Clerk OAuth access token for exactly `MCP_URL` (`<APP_URL>/mcp`, audience
  checked in `verifyMcpToken`) with the `profile` scope. `/mcp` and `/.well-known/*` are public to
  the proxy (`isPublicPath`); the route checks the token. `MCP_ENABLED=false` answers 503.
- Tools are defined in `src/server/mcp/server.ts` and implemented in `tools.ts`. They get the user
  only from the verified token (`runTool` → `userIdFrom`), never from input; no input schema has a
  user field. Mark reads `readOnly: true` and writes `false`. Tools never call our chat model; a
  search is one embedding recorded as `mcp-search`.
- Document text returned by a tool goes through `documentContentBlock` (`content.ts`) under
  `UNTRUSTED_NOTICE`. Never return passage text outside a block.
- Rate limits: every number lives in `src/lib/rate-limits.ts`; count with `consumeRateLimit`
  (`src/server/rate-limit.ts`) before the work, and answer 429 with its message.
- The Clerk webhook (`/api/webhooks/clerk`, `user.deleted`) deletes through `deleteUserData`
  (`src/server/account.ts`). A new user-data table must be added to `deleteUserRows` (and to
  `schema.test.ts`'s list).
- Security headers come from `src/lib/security-headers.ts` via `next.config.ts`. The CSP is
  enforced with no nonce (keeps Cache Components' static shells). A new third-party script, host,
  iframe or fetch target must be added there, or the browser blocks it; check with the e2e specs
  against `pnpm build && pnpm start`. `CSP_REPORT_ONLY=1` is an escape hatch, not a mode to stay in.
- The browser runs Zod `jitless` (`src/components/zod-browser-config.tsx`); without it Zod's eval
  probe is reported as a CSP violation.
- New Server Actions: `authedAction` only (a test enforces it). New route handlers: add them to
  the list in `src/server/authorization-audit.test.ts` with their check, and to `docs/security.md`.
- Before and after changing prompts, `escapeSourceText`, the MCP wrapping or the agent tools, run
  `pnpm eval:injection` (about 15 of the free tier's 20 daily requests; `--only` for a few) and
  commit the results file.

## Public pages rules (`docs/design/public`)

- `/` and `/how-we-test` live in `src/app/(public)/`: static (○ in `pnpm build`), no
  `ClerkProvider`, no `auth()`. The proxy redirects signed-in visitors from `/` to `/library`
  before the page renders; don't read the session in the page (it would make it dynamic).
- Keep Clerk and Zod off the public and error pages: links from them to `/sign-in`, `/sign-up`
  or app pages use `prefetch={false}` (a prefetch downloads Clerk's components).
  `tests/e2e/public.spec.ts` fails if any script they load mentions Clerk.
- "Measured, not promised" reads `src/content/eval-summary.json`, written by
  `scripts/eval-summary.ts` before every build from the newest full run of each eval. Partial
  (`--only`) and unfinished runs are skipped, and a metric the newest run lacks is hidden, never
  taken from an older run. After saving new eval results, run `pnpm eval:summary` and commit the
  JSON (a unit test checks they agree). Never hardcode a number on a public page.
- Footer name and links: `src/content/site.ts`. Metadata: the root layout's `%s | DocChat` title
  template, so pages set just their own title. Signed-in pages are `noindex`; the sitemap lists
  `indexablePaths` (`src/lib/routes.ts`). A new public URL must be added to `isPublicPath`, or the
  proxy sends signed-out visitors (and crawlers) to sign-in.
- Clerk's forms are themed in `src/features/public/clerk-appearance.ts` with style objects
  (Clerk's rules outrank Tailwind classes there) and worded through `AuthProvider`'s
  `localization`; Clerk's title is the auth pages' h1.
- Before calling public-page work done: the e2e and axe specs against `pnpm build && pnpm start`,
  and Lighthouse (mobile) 95+ for performance and accessibility on `/`. Clerk's development
  instance adds a handshake redirect for new browsers that production doesn't (about 2 s of
  simulated mobile LCP), so also measure once with its cookies: visit `/` in a browser, copy the
  `__clerk_db_jwt` and `__client_uat` cookies, and pass them with Lighthouse's
  `--extra-headers='{"Cookie":"…"}'`.

## Auth rules (Clerk)

- Auth uses `@clerk/nextjs`, the decided provider (`docs/adr/0002`). Treat the project as having
  an existing provider (Clerk).
- Never use Neon Auth or Better Auth (managed or self-hosted). The `neon` skills send login work
  to `neon-auth` and say to fetch it from neon.com; don't install or fetch it. We removed it
  on purpose. Skip their auth, `NEON_AUTH_*` and "Managed Better Auth" examples too.
- `ClerkProvider` wraps only the `(app)` and `(auth)` groups, through `AuthProvider`
  (`src/components/auth-provider.tsx`, which also holds the redirect URLs and the sign-in wording).
  Don't move it back to the root layout: the public pages would load Clerk's SDK.
- `src/proxy.ts` exports `clerkMiddleware` (there is no `middleware.ts` in Next 16). It only does
  optimistic redirects: signed-out visitors to `/sign-in`, signed-in visitors from `/` to
  `/library`. Public pages are listed in `isPublicPath()` (`src/lib/routes.ts`). Don't use
  `createRouteMatcher`; it's deprecated in `@clerk/nextjs` 7 (`docs/adr/0002`, amendment).
- The real checks sit next to the data. Server Components that read user data call
  `requireUserId()` (`src/server/auth.ts`) and pass the result to the feature query.
- `auth()` reads the request, so with Cache Components anything that calls it, or
  `requireUserId()`, must sit inside `<Suspense>` (the build fails otherwise). Keep it out of the
  top level of layouts; put it in a streamed child component. Clerk's `<SignIn />` and `<SignUp />`
  read the URL, so they need `<Suspense>` too (the `(auth)` layout provides it).
- Server Actions are built with `authedAction(schema, handler)` from `src/lib/action.ts`. It
  calls `auth()` first, then validates input with Zod, and returns
  `{ ok: true, data } | { ok: false, error, fieldErrors? }`. Don't hand-roll actions without it.
- `POST /api/chat` checks auth itself, then ownership through `ensureChat` (another user's chat
  id is a 404, never a new chat).
- Tables store Clerk's `userId` as `text`. There is no local `users` table; profile data stays in
  Clerk.
- One Clerk webhook: `user.deleted` deletes the user's rows and Blob files
  (`POST /api/webhooks/clerk`, verified with `CLERK_WEBHOOK_SIGNING_SECRET`). Its route is public:
  `verifyWebhook` is its only check; never put `auth.protect()` on it.

## Installed agent skills

All in `.claude/skills/`, tracked in `skills-lock.json` (update with `npx skills update`).

- `vercel/next.js`: next-* skills (cache components, partial prefetching, bundle, dev loop)
- `vercel/ai`: `ai-sdk`
- `shadcn/ui`: `shadcn` (plus the shadcn MCP server in `.mcp.json`)
- `clerk/skills`: `clerk` router and framework skills (use `clerk-nextjs-patterns`)
- `vercel-labs/agent-skills`: `vercel-react-best-practices`
- Neon (`neon skills`): `neon`, `neon-postgres`, `neon-postgres-branches`, and others
- Removed on purpose: `neon-auth` (pushes Better Auth) and `docs-diagrams` (only for writing
  Next.js's own docs). Don't reinstall them. `neon skills -y` reinstalls `neon-auth`, so name
  skills with `-s`.
