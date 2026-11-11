# Setup and operations

How to run DocChat locally (with Docker or pnpm), set up each service, and use the app's features in
development. The overview is in the [README](../README.md); tests and evals are in
[testing.md](testing.md).

## Run with Docker

`docker compose up` runs DocChat at [localhost:3000](http://localhost:3000) with its own Postgres,
so you don't need Node, pnpm or a Neon branch on your machine. You need Docker (Compose v2.17+
for build secrets) and the same `.env.local` as for `pnpm dev`.

```bash
cp .env.example .env.local   # then fill it in: see "Local setup" below
docker compose up --build    # first run builds the image (a few minutes)
```

What it starts (`docker-compose.yml`):

- **db**: Postgres 18 with pgvector 0.8.6 (`pgvector/pgvector:0.8.6-pg18`), the same major and
  extension as Neon. Data lives in the `db-data` volume; `docker compose down -v` deletes it.
- **migrate**: applies the migrations in `drizzle/`, then exits. The app waits for it.
- **app**: the production build (`Dockerfile`: Next.js standalone output on Node 24, as a
  non-root user, with a `HEALTHCHECK` on `/api/health`). `docker compose ps` shows it as healthy
  once the database answers.

The database settings in `.env.local` are ignored: compose points the app at its own Postgres.
Everything else comes from `.env.local`, and these services **stay external**, so their keys
must be there:

| Service         | Keys in `.env.local`                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| Clerk (sign-in) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`    |
| Vercel Blob     | `BLOB_READ_WRITE_TOKEN` (the private store; browsers upload straight to it)                |
| The AI provider | `GOOGLE_GENERATIVE_AI_API_KEY` (default; from a paid-tier project) or `AI_GATEWAY_API_KEY` |

`.env.local` reaches the build as a BuildKit secret (the public Clerk key and the CSP are built
in), never as an image layer. After changing it, rebuild: `docker compose up --build`. Port 3000
taken? `DOCCHAT_PORT=3200 docker compose up` (the MCP server's URL follows it). The database
publishes no port; Neon stays the database for `pnpm dev`.

## Local setup

Requires Node.js 24+ and Git. pnpm is pinned in `package.json` and runs through Corepack, so you
don't need a global install.

```bash
# 1. Install dependencies (also installs the git hooks via lefthook)
corepack pnpm install

# 2. Create your local env file, then fill in:
#    - DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct) for your Neon "dev" branch
#    - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY and CLERK_WEBHOOK_SIGNING_SECRET
#      (see "Clerk setup" below)
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

4. Under **Webhooks**, add an endpoint for `/api/webhooks/clerk` subscribed to `user.deleted`, and
   copy its signing secret (`whsec_…`) into `.env.local` as `CLERK_WEBHOOK_SIGNING_SECRET`
   (required). It deletes a user's data when they delete their account. Locally,
   `clerk webhooks listen --forward-to http://localhost:3000/api/webhooks/clerk` relays events.
5. For connecting AI apps (below), follow the Clerk steps in `docs/security.md`: register the MCP
   server URL, turn on CIMD, and set the default scopes.

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

| `EMBEDDING_PROVIDER` | Model                           | Key                            | Use                              |
| -------------------- | ------------------------------- | ------------------------------ | -------------------------------- |
| `google` (default)   | `gemini-embedding-001` (1536)   | `GOOGLE_GENERATIVE_AI_API_KEY` | development and production       |
| `gateway`            | `openai/text-embedding-3-small` | `AI_GATEWAY_API_KEY` or OIDC   | optional (needs gateway credits) |

**Gemini (default).** Create a key at [Google AI Studio](https://aistudio.google.com/apikey) in a
project with billing on (Tier 1 or above), and put it in `.env.local` as
`GOOGLE_GENERATIVE_AI_API_KEY`. Indexing, search, `pnpm db:seed` and `pnpm eval:retrieval` all
need it.

> **Use a paid-tier key.** On the paid tier Google doesn't use prompts or responses to improve
> its products, so real documents are fine. A key from a free-tier project puts everything sent
> under the free tier's terms (Google may use it) and its low limits, so keep those to the seed
> data and eval fixtures. Embeddings cost $0.15 per million tokens: about $0.02 for a dense
> 100-page PDF. The app paces itself and backs off on 429.

**AI Gateway (optional).** Add credits to the team's AI Gateway in the Vercel dashboard (the free
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

| `CHAT_PROVIDER`    | Answers                       | Follow-up rewrites           | Use                              |
| ------------------ | ----------------------------- | ---------------------------- | -------------------------------- |
| `google` (default) | `gemini-3.6-flash`            | `gemini-3.5-flash-lite`      | development and production       |
| `gateway`          | `anthropic/claude-sonnet-5.5` | `anthropic/claude-haiku-5.5` | optional (needs gateway credits) |

- **Cost on Gemini's paid tier.** A typical answer reads about 2,200 tokens and writes about 450
  (thinking included): about $0.003 at `gemini-3.6-flash`'s 2026 prices ($0.75 in, $3.75 out per
  million), about $0.007 from 1 January 2027, when they double. A long answer costs up to about
  $0.04. If the provider refuses for quota (a rate limit, or a used-up prepaid balance), DocChat
  says "DocChat's AI service is busy right now. Try again in a few minutes." and keeps the
  question. `CHAT_ANSWER_MODEL` picks another answer model on the same provider, e.g.
  `CHAT_ANSWER_MODEL=gemini-3.8-flash` (the newest Flash, overloaded when it was first tried) or
  `gemini-3.5-flash-lite`.
- `CHAT_DAILY_LIMIT` caps model calls per user per UTC day (default 25 with
  `CHAT_PROVIDER=google`, 50 with `gateway`), checked before any model call: "You've reached
  today's limit of N questions. It resets at midnight UTC." 25 calls cost one user about $0.08
  a day typically and at most about $1, so a small prepaid balance lasts.
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

### Tasks and the agent

Ask for tasks in the chat: "Turn my tenancy agreement into a move-in checklist", "What are my
deadlines?", "List my coursework deadlines" (`docs/adr/0007`).

- DocChat reads the closest passages, may search for more, and picks out what you need to do.
  The steps show what it did ("Read 9 passages from Tenancy agreement", "Picked out 6 things to
  do"), then a card asks **"Add N tasks to your list?"**.
- On the card, untick what you don't need, click a title to edit it, and set or change a date.
  Each task's chip shows the clause it came from in the Sources panel. **Nothing is saved until
  you click "Add N tasks"**; **Cancel** adds nothing. On a phone, the buttons sit in a bar at the
  bottom.
- Dates are only filled in when the document states them, or you gave the date a deadline counts
  from ("I move in on 1 November"). Otherwise the deadline is kept in words ("within 7 days of
  moving in") and the task shows **Add date**.
- Under an ordinary answer that mentions duties, deadlines or dates, **Turn this into tasks** asks
  for them in one click.
- A task request uses up to five model calls (usually two or three), and each counts towards
  `CHAT_DAILY_LIMIT`. Approving or cancelling uses none.

**Tasks** (`/tasks`) lists them with what's overdue, due this week, later, or undated. Add your
own with **Add a task** (and a date), tick tasks off, and use a task's **⋯** menu to edit, change
the date or delete it (with **Undo**). A task DocChat found links to its document and clause:
click it to read the passage with the sentence highlighted. Filter by document, or switch between
**To do**, **Done** and **All**.

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

### Use DocChat from Claude

Connect Claude Code, Claude Desktop, Cursor or another app that supports MCP, and it can search
your documents and manage your tasks with its own AI, without using DocChat's daily questions
(`docs/adr/0008`). **Settings** (user menu → Settings) shows your server URL with copy buttons.

- **Claude Code:** `claude mcp add --transport http docchat <your DocChat URL>/mcp`, then `/mcp`
  in Claude Code to sign in. Locally that's `http://localhost:3000/mcp`.
- **Claude Desktop:** Customize → Connectors → **Add custom connector**, paste the URL. Claude
  connects from its own servers, so this needs the deployed HTTPS address, not localhost.
- **Others:** add a remote MCP server (Streamable HTTP) with the URL.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transport Streamable HTTP, URL
  `http://localhost:3000/mcp`, then connect and complete its OAuth sign-in.

DocChat sends you to sign in and approve the app. It can then use five tools: `list_documents`,
`search_documents`, `list_tasks` (read-only), and `create_task`, `complete_task` (most apps ask
you before these). Passages come back with their document, page and a link to open them, inside
blocks marked as untrusted document content. Tasks it adds show **From your AI app**. Each app's
calls are limited to 60 a minute; set `MCP_ENABLED=false` to turn the server off.

This needs the Clerk dashboard steps in `docs/security.md` (MCP server URL, CIMD, default scopes)
on the instance you're using.

## Monitoring and logs

- **Errors: Sentry** (`@sentry/nextjs`), on only when `SENTRY_DSN` is set. Errors only (no
  tracing, Replay or feedback), and nothing personal: no document text, passages, prompts,
  answers, file names, emails, headers, cookies or request bodies. The Clerk user id is the only
  identifier. Reports go through our own origin (`/monitoring`). Source maps upload during the
  Vercel build when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are set. Setup steps
  are in `docs/launch-checklist.md`; the scrubbing is in `src/lib/monitoring.ts`.
- **Logs**: one JSON line per important event (`src/server/log.ts`): `document.indexed`,
  `document.index_failed`, `answer.generated` (tokens and latency), `agent.approved`,
  `agent.cancelled` and `quota.hit`. Fixed fields only (ids, counts, durations, model, error
  kind), never text. In Vercel's logs, filter on `"event":"quota.hit"`, for example.
- **Analytics**: Vercel Web Analytics and Speed Insights, cookie-free, rendered only on Vercel.
  Turn them on in the Vercel project (**Analytics** and **Speed Insights** tabs, then Enable).
- **Health**: `GET /api/health` answers `{"status":"ok"}` (200) when the database answers, and
  `{"status":"error"}` (503) otherwise. Nothing else: no versions, hosts or errors.

## Scripts

| Script                        | Description                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                    | Start the dev server                                               |
| `pnpm build`                  | Eval summary, then production build (validates env)                |
| `pnpm start`                  | Serve the production build                                         |
| `pnpm lint`                   | Run ESLint                                                         |
| `pnpm typecheck`              | Generate route types and run `tsc --noEmit`                        |
| `pnpm format`                 | Format with Prettier                                               |
| `pnpm format:check`           | Check formatting (used in CI)                                      |
| `pnpm test`                   | Run unit tests with Vitest                                         |
| `pnpm test:e2e`               | Run Playwright end-to-end tests (local)                            |
| `pnpm db:generate`            | Generate a SQL migration from the schema                           |
| `pnpm db:migrate`             | Apply pending migrations                                           |
| `pnpm db:studio`              | Open Drizzle Studio                                                |
| `pnpm db:seed`                | Reset and insert sample data (dev only)                            |
| `pnpm db:backfill-embeddings` | (Re-)embed passages not from the current model                     |
| `pnpm eval:retrieval`         | Run the retrieval eval (embeds for real)                           |
| `pnpm eval:answers`           | Run the answer eval (answers and judges for real)                  |
| `pnpm eval:agent`             | Run the agent eval (proposes tasks for real)                       |
| `pnpm eval:injection`         | Run the prompt-injection eval (hostile documents)                  |
| `pnpm eval:summary`           | Write `src/content/eval-summary.json` (the landing page's numbers) |
| `pnpm readme:evals`           | Write the README's eval table from the saved results               |
| `pnpm readme:tests`           | Write the README's test counts (dated)                             |
