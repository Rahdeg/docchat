# DocChat

DocChat lets you upload your documents and ask questions about them in plain language. Every answer
is grounded in your files and cites the exact passages it came from, so you can check it instead of
trusting it. Later it will also turn conversations into tasks with an agent that acts on what you
discussed.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack, Cache Components), React 19, TypeScript
- [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com), Geist fonts
- Zod + [`@t3-oss/env-nextjs`](https://env.t3.gg) for env validation
- [Neon](https://neon.com) Postgres + [Drizzle ORM](https://orm.drizzle.team) + pgvector
- [Clerk](https://clerk.com) for sign-in, sign-up and sessions
- [Vercel Blob](https://vercel.com/docs/vercel-blob) (private store) for uploaded files,
  [unpdf](https://github.com/unjs/unpdf) to read PDF text
- [Vercel AI SDK](https://ai-sdk.dev) v7 through
  [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), with `openai/text-embedding-3-small`
  embeddings
- Tooling: pnpm, ESLint, Prettier, lefthook, Vitest, Playwright, GitHub Actions

Architecture decisions are in [`docs/adr`](docs/adr). Conventions for contributors and coding agents
are in [`CLAUDE.md`](CLAUDE.md).

## Local setup

Requires Node.js 24+ and Git. pnpm is pinned in `package.json` and runs through Corepack, so you
don't need a global install.

```bash
# 1. Install dependencies (also installs the git hooks via lefthook)
corepack pnpm install

# 2. Create your local env file, then fill in:
#    - DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct) for your Neon "dev" branch
#    - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY (see "Clerk setup" below)
#    - BLOB_READ_WRITE_TOKEN (see "Vercel Blob setup" below)
#    - AI_GATEWAY_API_KEY (see "AI Gateway setup" below)
cp .env.example .env.local

# 3. Apply migrations
corepack pnpm db:migrate

# 4. Start the dev server at http://localhost:3000
corepack pnpm dev
```

### Clerk setup

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) (a development
   instance is fine) and pick the sign-in methods you want (email, Google, GitHub…).
2. In the dashboard, open **Configure → API keys** and copy the publishable key (`pk_test_…`) and
   secret key (`sk_test_…`) into `.env.local` as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `CLERK_SECRET_KEY`. Both are required; the build fails without them.
3. Optional: under **Settings**, rename the application to "DocChat" so the sign-in card says
   "Sign in to DocChat".

The sign-in and sign-up pages live in the app (`/sign-in`, `/sign-up`), so there's nothing else to
configure. After signing in you land on `/library`.

### Vercel Blob setup

Uploaded files are stored in a **private** Vercel Blob store. Nothing in it is publicly readable;
the app streams files to their owner through `/api/documents/[id]/file`.

1. In the Vercel dashboard, open the project's **Storage** tab, choose **Create Storage → Blob**,
   and set the access to **Private**. (Or from the linked project directory:
   `vercel blob create-store docchat-files --access private --yes`.)
2. Connect the store to the project **including the Development environment**. If you created it
   without Development, open the store's **Projects** tab, then **⋯ → Update Project Connection**,
   and tick **Development**. `vercel env pull` only reads Development.
3. Pull the variables into `.env.local`:

   ```bash
   vercel env pull .env.local
   ```

   This adds `BLOB_READ_WRITE_TOKEN` (required; the build fails without it), plus `BLOB_STORE_ID`
   and a short-lived `VERCEL_OIDC_TOKEN`. The app always uses `BLOB_READ_WRITE_TOKEN`: it's what
   browser uploads need, and the pulled OIDC token expires after a few hours. No webhook or tunnel
   is needed locally.

### AI Gateway setup

Embeddings (and, later, answers) go through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
with the AI SDK, so there are no provider keys to manage (`docs/adr/0005`).

1. In the Vercel dashboard, open **AI Gateway** for the team that owns the project and add credits.
   **The free tier can't use `openai/text-embedding-3-small`**: requests fail with
   `403 Free tier users do not have access to this model`, and documents fail to index.
2. Create an API key under **AI Gateway → API keys** and put it in `.env.local` as
   `AI_GATEWAY_API_KEY`. Indexing, search, `pnpm db:seed` and `pnpm eval:retrieval` all need it.
3. **On Vercel, no key is needed.** Deployments authenticate with the project's OIDC token, which
   Vercel issues and refreshes. Leave `AI_GATEWAY_API_KEY` unset there. If you do set one, it
   always takes precedence over OIDC, even when it's wrong. (Locally, the `VERCEL_OIDC_TOKEN` that
   `vercel env pull` writes expires after 12 hours, which is why the key is the local default.)

Every embedding call writes a row to `ai_usage` (user, kind, model, tokens), for future rate limits
and cost tracking.

### Uploading and indexing

- On `/library`, use **Upload files**, the **Add files** sheet, or drop files anywhere on the page.
  PDF, Markdown (`.md`) and text (`.txt`) only, **up to 10 MB each and 20 documents per account**.
  The browser checks these first; the server checks them again, including the file's real type.
- Files go straight from the browser to Blob (Vercel functions limit request bodies to 4.5 MB),
  then the app registers the document and starts reading it in the background.
- Reading ("indexing") extracts the text page by page (Markdown and text count as one page), splits
  each page into ~500-token passages with ~15% overlap, and stores the pages and passages with the
  exact character range each passage came from (`docs/adr/0004`). Then every passage is embedded
  through AI Gateway. The Library updates every few seconds: **Reading page X of Y**, then
  **Almost ready** while embedding, then **Ready** with page and passage counts. A document is
  only Ready once every passage has an embedding.
- Scanned PDFs (images, no text) fail with "No text found". A document that makes no progress for
  10 minutes shows **Reading stopped** with **Try again**.

### Finding passages

Answers come in a later PR. For now `/chat` has a **find passages** mode: ask a question and see
the five passages from your ready documents that DocChat would answer from, best match first, with
the document, page, the best-matching sentence highlighted, and a link to open that page. Choose
specific documents from the composer's document menu, and turn on **Show match scores** to see each
passage's similarity. Passages below the similarity floor (`MIN_SIMILARITY`) are hidden.

### Documents indexed before embeddings existed

Documents that became Ready before this version have passages without embeddings, so search skips
them. Embed them once, then apply the migration that makes embeddings required (it fails while any
passage is still missing one):

```bash
corepack pnpm db:backfill-embeddings --dry-run   # count what's missing
corepack pnpm db:backfill-embeddings             # safe to re-run
corepack pnpm db:migrate
```

To run it against another Neon branch, set `DATABASE_URL` (and `DATABASE_URL_UNPOOLED` for the
migration) on the command line.

### See sample data for your own account

1. Start the app, sign up, and copy your user ID (`user_…`) from the Clerk dashboard under **Users**.
2. Seed sample documents, a chat and tasks for that user:

   ```bash
   corepack pnpm db:seed --user user_xxxxxxxx
   # or: SEED_USER_ID=user_xxxxxxxx corepack pnpm db:seed
   ```

   This first deletes any existing data for that user in your dev database, and embeds the sample
   passages through AI Gateway (so it needs `AI_GATEWAY_API_KEY`). Without `--user` it seeds a
   placeholder user (`user_seed_dev`) you can't sign in as. Sample documents have no
   stored file, so they can't be opened or retried. Re-run the seed after pulling new migrations.

3. Reload `/library`.

Tip: run `corepack enable pnpm` once if you'd rather type `pnpm` without `corepack`.

## Scripts

| Script                        | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `pnpm dev`                    | Start the dev server                        |
| `pnpm build`                  | Production build (validates env)            |
| `pnpm start`                  | Serve the production build                  |
| `pnpm lint`                   | Run ESLint                                  |
| `pnpm typecheck`              | Generate route types and run `tsc --noEmit` |
| `pnpm format`                 | Format with Prettier                        |
| `pnpm format:check`           | Check formatting (used in CI)               |
| `pnpm test`                   | Run unit tests with Vitest                  |
| `pnpm test:e2e`               | Run Playwright end-to-end tests (local)     |
| `pnpm db:generate`            | Generate a SQL migration from the schema    |
| `pnpm db:migrate`             | Apply pending migrations                    |
| `pnpm db:studio`              | Open Drizzle Studio                         |
| `pnpm db:seed`                | Reset and insert sample data (dev only)     |
| `pnpm db:backfill-embeddings` | Embed passages that have no embedding       |
| `pnpm eval:retrieval`         | Run the retrieval eval (calls AI Gateway)   |

## Testing

- `pnpm test` runs the unit tests. Integration tests (`*.integration.test.ts`) also run when
  `DATABASE_URL` is set, and skip themselves otherwise (as in CI). The ones that index or search
  with real embeddings also need `AI_GATEWAY_API_KEY` (and gateway credits).
- `pnpm test:e2e` runs Playwright against `pnpm dev`. It reuses a dev server that's already running,
  or starts one. To test a production build, run `pnpm build && pnpm start` and set
  `E2E_BASE_URL=http://localhost:3000`. It needs the Clerk keys in `.env.local`. The first time,
  run `corepack pnpm exec playwright install chromium`.
- The PDF fixtures in `tests/fixtures/` (two text pages, and a page with no text) come from
  `node tests/fixtures/make-pdfs.mjs`. The indexing integration test reads them from disk, so it
  needs a database but not Blob.
- **E2E tests don't run in CI yet.** CI runs typecheck, lint, format check, unit tests and the build.
  The signed-in upload flow isn't covered by e2e yet (it needs Clerk testing tokens).

### Retrieval eval

`pnpm eval:retrieval` measures how well search finds the right passage, so a change to the
embedding model, chunking or the search query can be judged by numbers instead of by feel
(`docs/adr/0005`).

- It indexes two fictional fixture documents (`tests/evals/fixtures/`: a tenancy agreement and an
  employment contract, six pages each) for a dedicated `eval_retrieval` user in your dev database,
  replacing that user's previous run, through the real extract, chunk and embed pipeline.
- It asks the 15 questions in `tests/evals/retrieval.json` (direct, paraphrased, answers split
  across a chunk boundary, and one with no answer) and prints **hit@1, hit@3, hit@5 and MRR**, a
  table of questions whose right passage wasn't ranked first, and the numbers for setting
  `MIN_SIMILARITY` (it warns when a right passage would be hidden by the floor).
- Results are saved to `tests/evals/results/retrieval-<date>.json` with the model, chunk settings
  and git commit. Commit them so runs can be compared.
- A run costs a fraction of a cent, but needs `AI_GATEWAY_API_KEY`, so **it doesn't run in CI**.
  CI does run `tests/evals/retrieval-cases.test.ts`, which checks every question's page and quote
  against the fixtures and chunker without calling a model.
- The fixtures come from `node tests/evals/fixtures/make-fixtures.mjs`. If you change them, re-check
  the questions (the test above tells you which broke).
