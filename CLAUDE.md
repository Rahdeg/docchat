# DocChat

Users upload documents and ask questions; answers come back with cited sources (RAG). A later
phase adds an agent that creates tasks from conversations.

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
- Vercel AI SDK v7 (`ai`) through Vercel AI Gateway; embeddings with
  `openai/text-embedding-3-small` (1536 dimensions, `docs/adr/0005`)
- Data flow: Server Components for reads, Server Actions for writes (no tRPC, see
  `docs/adr/0001`). Route handlers only where an action can't work: Blob upload tokens and
  serving stored files (`src/app/api/documents/`), and later chat streaming
- Tooling: pnpm (pinned via `packageManager`), ESLint 9 flat config, Prettier, lefthook, Vitest,
  Playwright (e2e)

## Commands

pnpm is pinned per project and not installed globally. Run it through Corepack (`corepack pnpm <cmd>`),
or run `corepack enable pnpm` once if you want a bare `pnpm`.

| Command                       | What it does                                     |
| ----------------------------- | ------------------------------------------------ |
| `pnpm dev`                    | Dev server (Turbopack)                           |
| `pnpm build`                  | Production build (also validates env)            |
| `pnpm start`                  | Serve the production build                       |
| `pnpm lint`                   | ESLint (`next lint` no longer exists in Next 16) |
| `pnpm typecheck`              | `next typegen` then `tsc --noEmit`               |
| `pnpm format`                 | Prettier write                                   |
| `pnpm format:check`           | Prettier check (CI)                              |
| `pnpm test`                   | Vitest, single run                               |
| `pnpm test:e2e`               | Playwright e2e (local only, not in CI yet)       |
| `pnpm db:generate`            | Generate a SQL migration from the schema         |
| `pnpm db:migrate`             | Apply pending migrations (direct connection)     |
| `pnpm db:studio`              | Drizzle Studio against `DATABASE_URL_UNPOOLED`   |
| `pnpm db:seed`                | Reset and insert sample data (development only)  |
| `pnpm db:backfill-embeddings` | Embed chunks of ready documents that have none   |
| `pnpm eval:retrieval`         | Retrieval eval: hit@k, MRR, floor calibration    |

`pnpm db:seed --user user_…` (or `SEED_USER_ID=user_…`) seeds a real Clerk user so the data shows
up after signing in. It deletes that user's existing rows first.

Before you call a change done: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

## Folder conventions

```
src/app/(auth)/        sign-in / sign-up routes (Clerk)
src/app/(app)/         authenticated app routes
src/components/ui/     shadcn-generated. Do not hand-edit.
src/components/        shared app components built on ui/
src/features/<name>/   feature modules: documents, chat, tasks (components, actions, schemas,
                       queries.ts for user-scoped reads)
src/server/auth.ts     requireUserId() for Server Components
src/server/db/         Drizzle client (index.ts) and schema/ (one file per area)
src/server/ai/         AI SDK setup, chunking, retrieval, prompts, tools (server-only)
src/server/ingest/     text extraction and the indexing pipeline (server-only)
src/server/blob.ts     the only place that calls the Vercel Blob SDK
src/lib/               utilities (cn, env, format, routes) and authedAction() (action.ts)
src/proxy.ts           clerkMiddleware with optimistic redirects (Next 16 replaces middleware.ts)
docs/adr/              architecture decision records
docs/design/           HTML design mockups per area; match them when building that UI
drizzle/               generated SQL migrations and snapshots (committed)
scripts/               standalone scripts run with tsx (seed, backfill-embeddings)
tests/e2e/             Playwright end-to-end tests (`*.spec.ts`)
tests/fixtures/        test files (PDFs), the PDF writer (pdf.mjs) and the script that uses it
tests/evals/           retrieval eval: fixtures, questions (retrieval.json), runner, results/
```

Unit tests sit next to the code as `*.test.ts(x)`. Playwright tests live in `tests/e2e/` and run
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
- `font-serif` (Newsreader) is only for document names and document text. All UI stays Geist;
  don't use Geist Mono for UI labels.
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
- Anything Drizzle can't express (extensions) goes in a custom migration:
  `pnpm db:generate --custom --name=<name>`.
- Queries live in `src/features/<area>/queries.ts`, start with `import "server-only"`, take
  `userId` as their first argument and filter by it. Use the query builder; raw SQL is only for
  vector search.
- Every user-data table has a `user_id` column with an index. Child tables (`chunk`, `message`)
  copy it from their parent so they can be filtered without a join.
- Multi-row writes that must succeed together (a document's chunks) use `db.transaction`.
- `EMBEDDING_DIMENSIONS` in `src/server/ai/constants.ts` must match the embedding model
  (`EMBEDDING_MODEL_DIMENSIONS` in `src/server/ai/models.ts`; a unit test checks both). Changing
  it needs a migration and re-embedding; a unit test fails if the migration is missing.
- Scripts and drizzle-kit run with `--conditions=react-server` so `server-only` imports resolve
  outside Next. The `db:*` scripts already do this.
- Integration tests (`*.integration.test.ts`) use `describe.skipIf(!process.env.DATABASE_URL)` and
  import database modules lazily. Tests that call AI Gateway (anything that indexes or searches
  with a real query) also skip without `AI_GATEWAY_API_KEY`. CI has neither and sets
  `SKIP_ENV_VALIDATION`.

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
  (`docs/adr/0004`). `chunk.embedding` is `NOT NULL`: chunks are embedded before the transaction
  that stores them, and a document is `ready` only when all of them are. While embedding, the
  Library shows "Almost ready".
- Regenerate the PDF fixtures with `node tests/fixtures/make-pdfs.mjs`.

## AI rules (AI SDK + AI Gateway)

- Read `.claude/skills/ai-sdk` and the installed docs in `node_modules/ai/docs/` before writing AI
  SDK code; don't write it from memory.
- Every model call goes through the gateway instance in `src/server/ai/models.ts`
  (`createGateway({ apiKey: env.AI_GATEWAY_API_KEY })`), with `provider/model` IDs. Don't install
  provider packages or read keys from `process.env`.
- `AI_GATEWAY_API_KEY` is optional in env: Vercel deployments authenticate with OIDC. Locally it's
  required (indexing, search, the seed and the eval). A key always wins over OIDC, even an invalid
  one. The model needs paid gateway credits; the free tier answers 403.
- Embed only through `src/server/ai/embed.ts` (`embedChunks`, `embedQuery`). It batches (100
  texts, 50k tokens), retries, validates every vector's size, and writes an `ai_usage` row after
  each call. Don't call `embed`/`embedMany` directly.
- Vector search lives in `src/server/ai/retrieve.ts`: raw SQL with
  `set local hnsw.iterative_scan = relaxed_order` inside its own transaction, so the user filter
  can't cut results short (`docs/adr/0005`). Never use a session-wide `set` (the pooled connection
  is shared).
- `searchPassages` has no similarity floor by default; callers that show results pass
  `MIN_SIMILARITY` (`findPassages` does). The eval relies on the raw ranking.
- Before and after changing the embedding model, chunking or search, run `pnpm eval:retrieval`
  and commit both results files. If the fixtures or chunker change, `retrieval-cases.test.ts` says
  which questions need new pages or quotes.

## Auth rules (Clerk)

- Auth uses `@clerk/nextjs`, the decided provider (`docs/adr/0002`). Treat the project as having
  an existing provider (Clerk).
- Never use Neon Auth or Better Auth (managed or self-hosted). The `neon` skills send login work
  to `neon-auth` and say to fetch it from neon.com; don't install or fetch it. We removed it
  on purpose. Skip their auth, `NEON_AUTH_*` and "Managed Better Auth" examples too.
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
- Tables store Clerk's `userId` as `text`. There is no local `users` table; profile data stays in
  Clerk.
- No Clerk webhooks yet. Deleting a user's data when Clerk sends `user.deleted` comes in a later
  PR (TODO in `src/server/auth.ts`). Until then, deleting a user in Clerk leaves their rows behind.

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
