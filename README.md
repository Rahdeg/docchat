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
  [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) (production) or Gemini's free tier
  (development) for embeddings and cited answers
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
#    - GOOGLE_GENERATIVE_AI_API_KEY (see "Embeddings setup" and "Answers setup" below)
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

### Embeddings setup

Passages and questions are turned into embeddings by the provider in `EMBEDDING_PROVIDER`
(`docs/adr/0005`):

| `EMBEDDING_PROVIDER` | Model                           | Key                            | Use                                |
| -------------------- | ------------------------------- | ------------------------------ | ---------------------------------- |
| `google` (default)   | `gemini-embedding-001` (1536)   | `GOOGLE_GENERATIVE_AI_API_KEY` | development, fictional files only  |
| `gateway`            | `openai/text-embedding-3-small` | `AI_GATEWAY_API_KEY` or OIDC   | production (needs gateway credits) |

**Development (default).** Create a key at [Google AI Studio](https://aistudio.google.com/apikey)
and put it in `.env.local` as `GOOGLE_GENERATIVE_AI_API_KEY`. Indexing, search, `pnpm db:seed` and
`pnpm eval:retrieval` all need it.

> **The Gemini free tier is for development with fictional documents only** (the seed data, the
> eval fixtures, sample uploads). Google may use free-tier content to improve its products, and
> its rate limits are low (about 100 requests a minute; the app paces itself and backs off on
> 429). Don't upload real documents while it's in use. Production switches to the gateway before
> launch.

**Production (AI Gateway).** Add credits to the team's AI Gateway in the Vercel dashboard (the free
tier refuses this model with `403 Free tier users do not have access to this model`) and set
`EMBEDDING_PROVIDER=gateway`. On Vercel no key is needed: deployments authenticate with the
project's OIDC token, so leave `AI_GATEWAY_API_KEY` unset there (if set, it always wins over OIDC,
even when it's wrong). Locally, use a key from **AI Gateway → API keys**; the `VERCEL_OIDC_TOKEN`
that `vercel env pull` writes expires after 12 hours.

**Switching providers** means re-embedding, since vectors from different models can't be compared.
Each passage records the model that embedded it, and search ignores passages from other models
until they're re-embedded:

```bash
# after changing EMBEDDING_PROVIDER (and its key)
corepack pnpm db:backfill-embeddings   # re-embeds everything made by another model
corepack pnpm eval:retrieval           # then set that provider's minSimilarity from the output
```

Every embedding call writes a row to `ai_usage` (user, kind, model, tokens), for future rate limits
and cost tracking. Gemini doesn't report tokens, so its rows hold an estimate.

### Uploading and indexing

- On `/library`, use **Upload files**, the **Add files** sheet, or drop files anywhere on the page.
  PDF, Markdown (`.md`) and text (`.txt`) only, **up to 10 MB each and 20 documents per account**.
  The browser checks these first; the server checks them again, including the file's real type.
- Files go straight from the browser to Blob (Vercel functions limit request bodies to 4.5 MB),
  then the app registers the document and starts reading it in the background.
- Reading ("indexing") extracts the text page by page (Markdown and text count as one page), splits
  each page into ~500-token passages with ~15% overlap, and stores the pages and passages with the
  exact character range each passage came from (`docs/adr/0004`). Then every passage is embedded
  (see "Embeddings setup"). The Library updates every few seconds: **Reading page X of Y**, then
  **Almost ready** while embedding, then **Ready** with page and passage counts. A document is
  only Ready once every passage has an embedding.
- Scanned PDFs (images, no text) fail with "No text found". A document that makes no progress for
  10 minutes shows **Reading stopped** with **Try again**.

### Answers setup

Answers come from the provider in `CHAT_PROVIDER` (`docs/adr/0006`), which works like
`EMBEDDING_PROVIDER` and uses the same keys:

| `CHAT_PROVIDER`    | Answers                       | Follow-up rewrites           | Use                                |
| ------------------ | ----------------------------- | ---------------------------- | ---------------------------------- |
| `google` (default) | `gemini-3.6-flash`            | `gemini-3.5-flash-lite`      | development, fictional files only  |
| `gateway`          | `anthropic/claude-sonnet-5.5` | `anthropic/claude-haiku-5.5` | production (needs gateway credits) |

- **The Gemini free tier allows 20 answers a day for the whole project** (per model; it resets at
  midnight Pacific). When it's used up, DocChat says so. `CHAT_ANSWER_MODEL` picks another
  answer model on the same provider, e.g. `CHAT_ANSWER_MODEL=gemini-3.8-flash` (the newest Flash,
  overloaded on its free tier when this was written) or `gemini-3.5-flash-lite`.
- `CHAT_DAILY_LIMIT` caps answers per user per UTC day (default 10 with `CHAT_PROVIDER=google`, 50
  with `gateway`), checked before any model call: "You've reached today's limit of N questions. It resets at midnight UTC."
- Every generation writes an `ai_usage` row (kind `chat`, `rewrite` or `judge`, input and output
  tokens).

### Asking questions

On `/chat`, ask a question about your ready documents (or the ones you pick in the composer's
document menu). **New chat** opens an empty chat; it's saved with your first question, titled after
it, and listed under **Recent chats** in the sidebar, where its menu renames or deletes it.

- DocChat reads the passages closest to the question (**Read 5 passages from 2 documents** opens
  them), then streams an answer written only from them. **Stop** ends it early; **Try again**
  answers the last question again. Follow-up questions are rewritten into a standalone search
  first, using the conversation.
- Every claim carries a numbered chip. On a computer, hover a chip to preview its passage, and
  click it to show it in the **Sources** panel on the right, with the sentence the answer relied
  on highlighted and a link to open that page. Passages read but not cited are listed below. On a
  phone, tapping a chip opens the source in a sheet, with previous and next.
- If no passage is close enough, or the passages don't answer the question, the answer starts
  **"Your documents don't say"** and has no citations.
- Copy, thumbs up and thumbs down sit under each answer; the thumbs are saved on the message.

### Upgrading a database from before embeddings

Migration 0005 makes every passage's embedding required, and fails if any passage doesn't have one
from the current model yet. `pnpm db:migrate` applies all pending migrations in **one
transaction**, so a failure also rolls back the migrations before it. On a branch that already
has documents from before this version:

- **Simplest:** remove those documents in the Library (or reset the branch's data), then
  `corepack pnpm db:migrate`, then upload them again.
- **To keep them:** the backfill needs migration 0004's `embedding_model` column, so it only works
  on a branch that is already at 0004. Then:

  ```bash
  corepack pnpm db:backfill-embeddings --dry-run   # count what's missing
  corepack pnpm db:backfill-embeddings             # safe to re-run
  corepack pnpm db:migrate                         # 0005
  ```

To run either against another Neon branch, set `DATABASE_URL` (and `DATABASE_URL_UNPOOLED` for the
migration) on the command line.

### See sample data for your own account

1. Start the app, sign up, and copy your user ID (`user_…`) from the Clerk dashboard under **Users**.
2. Seed sample documents, a chat and tasks for that user:

   ```bash
   corepack pnpm db:seed --user user_xxxxxxxx
   # or: SEED_USER_ID=user_xxxxxxxx corepack pnpm db:seed
   ```

   This first deletes any existing data for that user in your dev database, and embeds the sample
   passages with `EMBEDDING_PROVIDER` (so it needs that provider's key). Without `--user` it seeds a
   placeholder user (`user_seed_dev`) you can't sign in as. Sample documents have no
   stored file, so they can't be opened or retried. Re-run the seed after pulling new migrations.

3. Reload `/library`.

Tip: run `corepack enable pnpm` once if you'd rather type `pnpm` without `corepack`.

## Scripts

| Script                        | Description                                       |
| ----------------------------- | ------------------------------------------------- |
| `pnpm dev`                    | Start the dev server                              |
| `pnpm build`                  | Production build (validates env)                  |
| `pnpm start`                  | Serve the production build                        |
| `pnpm lint`                   | Run ESLint                                        |
| `pnpm typecheck`              | Generate route types and run `tsc --noEmit`       |
| `pnpm format`                 | Format with Prettier                              |
| `pnpm format:check`           | Check formatting (used in CI)                     |
| `pnpm test`                   | Run unit tests with Vitest                        |
| `pnpm test:e2e`               | Run Playwright end-to-end tests (local)           |
| `pnpm db:generate`            | Generate a SQL migration from the schema          |
| `pnpm db:migrate`             | Apply pending migrations                          |
| `pnpm db:studio`              | Open Drizzle Studio                               |
| `pnpm db:seed`                | Reset and insert sample data (dev only)           |
| `pnpm db:backfill-embeddings` | (Re-)embed passages not from the current model    |
| `pnpm eval:retrieval`         | Run the retrieval eval (embeds for real)          |
| `pnpm eval:answers`           | Run the answer eval (answers and judges for real) |

## Testing

- `pnpm test` runs the unit tests. Integration tests (`*.integration.test.ts`) also run when
  `DATABASE_URL` is set, and skip themselves otherwise (as in CI). The ones that index or search
  with real embeddings also need the configured provider's key (`GOOGLE_GENERATIVE_AI_API_KEY` by
  default). The ones that call the chat model also need `LIVE_CHAT_TESTS=1`, so a plain
  `pnpm test` doesn't spend the free tier's 20 answers a day:
  `LIVE_CHAT_TESTS=1 corepack pnpm test` (uses about 4).
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
  `MIN_SIMILARITY`: it also runs three off-topic probes (not scored), suggests a floor, and warns
  when a right passage would be hidden by it.
- First run (Gemini, 2026-10-27): **hit@1 92.9%, hit@3 92.9%, hit@5 100%, MRR 0.946**, floor
  0.55.
- Results are saved to `tests/evals/results/retrieval-<date>.json` with the model, chunk settings
  and git commit. Commit them so runs can be compared.
- `--only=<ids>` runs just those questions (see "Rerunning a few questions" below), without the
  floor calibration.
- A run is free on Gemini's free tier and a fraction of a cent on the gateway, but needs the
  provider's key, so **it doesn't run in CI**.
  CI does run `tests/evals/retrieval-cases.test.ts`, which checks every question's page and quote
  against the fixtures and chunker without calling a model.
- The fixtures come from `node tests/evals/fixtures/make-fixtures.mjs`. If you change them, re-check
  the questions (the test above tells you which broke).

### Answer eval

`pnpm eval:answers` measures the answers themselves (`docs/adr/0006`), with the retrieval eval's
fixtures and questions plus its off-topic probes:

- **Citation accuracy**: the expected page is among the cited sources.
- **Grounding**: a judge model answers "Does this passage support this claim?" for every cited
  claim, with a one-line reason; the score is the share supported.
- **Honesty**: the no-answer question gets "Your documents don't say" with no citations; the
  off-topic probes get that or the one-line reply about DocChat itself.
- **Quote match rate**: the share of citations whose quote was found in the cited passage.
- **Answer checks**: questions with an `answer` check in `retrieval.json` must say what it
  expects. `long-service-notice` must work out 7 weeks of notice (4 + 3), not 9.

It prints a summary table and every failure, and saves `tests/evals/results/answers-<date>.json`.
A run needs about 17 answers, close to the free tier's 20 a day, so calls are spaced out and
progress is saved after each one: if the quota runs out, run it again after the reset and it
continues (`--fresh` starts over). It doesn't run in CI.

First run on the default `gemini-3.6-flash` (2026-10-31, judge `gemma-4-26b-a4b-it`):
**citation accuracy 100%, grounding 85%, honesty 100%, quote match rate 100%** (ADR 0006).

### Rerunning a few questions

A full answer eval uses most of the free tier's 20 answers a day. To recheck a handful after a
prompt change, name them with `--only` (comma-separated ids from `tests/evals/retrieval.json`;
the off-topic probes are `off-topic-1` to `off-topic-5`):

```bash
corepack pnpm eval:answers --only=long-service-notice,company-car
corepack pnpm eval:retrieval --only=remote-work,off-topic-4
```

- It asks only those questions (one answer each, plus a judge call per cited claim) and reuses
  the fixtures already indexed for the eval user, so it embeds only the questions.
- It saves to `answers-<date>-only.json` or `retrieval-<date>-only.json`, so the day's full run
  isn't overwritten. An unfinished `--only` run continues like a full one.
- An unknown id stops the run and lists the known ones.
- The scores cover only the questions asked, and the retrieval eval skips the floor
  calibration. Use a full run for the numbers you publish.
