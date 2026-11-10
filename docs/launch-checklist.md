# Launch checklist: opening sign-ups

DocChat launches on the Gemini API's paid tier (`EMBEDDING_PROVIDER=google`,
`CHAT_PROVIDER=google`, the defaults; `docs/adr/0005` amendment). On the paid tier Google doesn't
use prompts or responses to improve its products, so real documents are fine. Until sign-ups
open, a Clerk sign-up allowlist keeps the app to invited users. The Vercel AI Gateway is
optional: see "Optional: switch to the AI Gateway" at the end. Work through this list in order;
each step says how to check it.

Placeholders: `<domain>` is the production domain (e.g. `docchat.app`), `<neon-project>` is the
Neon project id (`neonctl projects list`).

## 0. Before you start

- [ ] `main` is green in CI (both the `ci` and `e2e` jobs) and deployed.
- [ ] Migrations on Neon `main` are current:
      `DATABASE_URL_UNPOOLED="$(neonctl connection-string main --project-id <neon-project>)" corepack pnpm db:migrate`
      prints "migrations applied successfully" (or nothing to apply).
- [ ] The Gemini project is on the paid tier: [AI Studio](https://aistudio.google.com) →
      **Usage & Billing** (or **API keys**, the key's project) shows **Tier 1** or above, with
      a prepaid balance.
- [ ] The production key belongs to that project. In Vercel → **Settings** → **Environment
      Variables**, `GOOGLE_GENERATIVE_AI_API_KEY` for **Production** must be a key listed under
      the paid project in AI Studio → **API keys**. A key from another (free-tier) project
      would put users' documents under the free tier's terms. Check Preview too.
- [ ] Set up a warning before the balance runs out: Google Cloud console → **Billing** →
      **Budgets & alerts** → a budget on the project at, say, 50% and 90% of the balance. When
      the balance is used up, Gemini refuses and users see "DocChat's AI service is busy right
      now. Try again in a few minutes." (their question is kept).

## 1. The daily limit and the budget

`CHAT_DAILY_LIMIT` (model calls per user per UTC day; an answer is one, a task request up to
five) defaults to **25** on `google` (`src/server/ai/limits.ts`, sized in `docs/adr/0006`
section 8).

- [ ] Check the cost against the balance. A typical answer is about $0.003 now and $0.007 from
      1 January 2027, when `gemini-3.6-flash` doubles in price; a long one up to $0.04. So 25
      calls cost one user about $0.08 to $0.17 a day typically and at most about $1. The real
      numbers: `psql "$DATABASE_URL" -c "select model, count(*), avg(input_tokens), avg(output_tokens) from ai_usage where kind = 'chat' group by 1"`.
- [ ] The limit caps each user, not the total. With N active users, the balance lasts about
      balance ÷ (N × daily cost). Top up before opening sign-ups widely, or set a lower
      `CHAT_DAILY_LIMIT` in Vercel Production (no code change, just a redeploy).
- [ ] Optional: re-run the evals for fresh public numbers (the models haven't changed, so the
      current ones still hold). A full run of all four costs well under $1:
      `corepack pnpm eval:retrieval && corepack pnpm eval:answers && corepack pnpm eval:agent && corepack pnpm eval:injection && corepack pnpm eval:summary`,
      then commit `tests/evals/results` and `src/content/eval-summary.json`.

## 2. Production environment (Vercel)

In the Vercel dashboard → the project → **Settings** → **Environment Variables**, for
**Production** (and **Preview**, if previews should match):

| Variable                       | Value                                   |
| ------------------------------ | --------------------------------------- |
| `EMBEDDING_PROVIDER`           | `google` (or unset: it's the default)   |
| `CHAT_PROVIDER`                | `google` (or unset)                     |
| `GOOGLE_GENERATIVE_AI_API_KEY` | a key from the paid project (step 0)    |
| `CHAT_DAILY_LIMIT`             | unset for 25, or the number from step 1 |
| `AI_GATEWAY_API_KEY`           | unset (only for the optional gateway)   |

- [ ] Redeploy production (**Deployments** → the latest → **Redeploy**, or
      `vercel --prod`). Env changes take effect only on a new deployment.
- [ ] Nothing to re-embed: production already uses `google/gemini-embedding-001`, and the paid
      tier serves the same model.

## 3. Clerk production instance

- [ ] Clerk dashboard → the application → instance switcher (top) → **Create production
      instance** (clone the development settings).
- [ ] **Domains**: set `<domain>`, then add the DNS records Clerk lists (the `clerk.`,
      `accounts.`, `clkmail.` and DKIM CNAMEs) at your DNS host. Wait until every record shows
      verified, and Clerk has issued certificates.
- [ ] **SSO connections**: the development instance uses Clerk's shared OAuth credentials; the
      production instance needs your own. For each social provider you offer (Google,
      GitHub…), create an OAuth app with the redirect URI Clerk shows, and paste its client id
      and secret.
- [ ] **API keys**: copy `pk_live_…` and `sk_live_…` into Vercel **Production** as
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. The publishable key is built
      into the pages and the CSP (it names the Clerk host), so redeploy afterwards. Keep the
      `pk_test_`/`sk_test_` keys in Preview and Development, and in the GitHub secrets for CI.
- [ ] **Webhook**: production instance → **Webhooks** → **Add endpoint**:
      `https://<domain>/api/webhooks/clerk`, subscribed to `user.deleted` only. Copy its
      signing secret into Vercel Production as `CLERK_WEBHOOK_SIGNING_SECRET`.
- [ ] **MCP server**: set `APP_URL=https://<domain>` in Vercel Production (tokens are checked
      for exactly `<APP_URL>/mcp`). Then repeat `docs/security.md` → "Clerk dashboard steps" on
      the production instance with `sk_live_…`: register `https://<domain>/mcp`, turn on CIMD,
      and set the default scopes (the `curl -X PATCH …/oauth_application_settings` call).
- [ ] **Remove the sign-up allowlist**: production instance → **Configure** → **Restrictions** →
      **Allowlist** → off. Keep the blocklist and bot protection on. Do this last, after
      step 4 passes.

## 4. Sentry (if not already on)

- [ ] Create an organization at [sentry.io](https://sentry.io), choosing the **EU (Frankfurt)**
      data region (our database is in `eu-central-1`). Then **Projects** → **Create project** →
      platform **Next.js** → name `docchat`. Skip the wizard; the code is already set up.
- [ ] **Project Settings** → **Client Keys (DSN)**: copy the DSN into Vercel (Production and
      Preview) as `SENTRY_DSN`.
- [ ] **Settings** → **Organization Tokens** (under Developer Settings) → **Create New Token**:
      copy it into Vercel (Production and Preview, marked sensitive) as `SENTRY_AUTH_TOKEN`. Set
      `SENTRY_ORG` (the organization slug in Sentry's URL) and `SENTRY_PROJECT` (`docchat`). With
      all three, the Vercel build uploads source maps; without them it skips the upload.
- [ ] **Project Settings** → **Security & Privacy**: turn on **Data Scrubber**, **Use Default
      Scrubbers** and **Prevent Storing of IP Addresses**. The app already scrubs before
      sending (`src/lib/monitoring.ts`); this is a second net.
- [ ] **Project Settings** → **General** → **Allowed Domains**: `<domain>`, plus the Vercel
      preview pattern if Preview reports.
- [ ] Don't install Sentry's Vercel integration. It sets its own env vars and options.
- [ ] Redeploy. Check: open the site, and in the browser console run
      `setTimeout(() => { throw new Error("Sentry check") })`. The issue appears in Sentry
      within a minute, with your Clerk user id and no other user fields.

## 5. Vercel Web Analytics and Speed Insights

- [ ] Vercel project → **Analytics** → **Enable**, and **Speed Insights** → **Enable**. The
      code already renders both on Vercel (cookie-free, same-origin `/_vercel/*`, nothing to add
      to the CSP). Data shows up after the next deployment gets visits.

## 6. Smoke test on production

Use a fresh browser profile on `https://<domain>`:

- [ ] `curl -s https://<domain>/api/health` → `{"status":"ok"}`.
- [ ] `/` loads signed out, with the eval numbers. Sign up with a new email (the allowlist is
      off now), then land on `/library`.
- [ ] Upload a short PDF: it reaches **Ready**. Vercel logs show
      `"event":"document.indexed"` with `"model":"google/gemini-embedding-001"`.
- [ ] Ask a question it answers: a cited answer streams. Open the chip: the passage is
      highlighted, and "Open page" opens the PDF. The logs show `"event":"answer.generated"` with
      `"model":"google/gemini-3.6-flash"` and token counts.
- [ ] Ask something it doesn't cover: "Your documents don't say…".
- [ ] "Turn this into tasks" on an answer with deadlines: untick one, **Add**, and the tasks are
      on `/tasks`. Cancel on a second request adds nothing.
- [ ] Settings shows `https://<domain>/mcp`. Connect it from Claude
      (`claude mcp add --transport http docchat https://<domain>/mcp`) and search a document.
- [ ] Delete the test account (user menu → Manage account → Delete account). The webhook
      removes its rows and files: the Clerk webhook's log shows a 200 for `user.deleted`.
- [ ] AI Studio → **Usage & Billing** shows the requests and the balance going down. Sentry shows
      no new issues.

## Rolling back

**If the problem is the deployment (code)**: Vercel → **Deployments** → the previous production
deployment → **Instant Rollback**. Env vars are not part of that rollback; they stay as set.

**If the problem is the models or the budget:**

- **An answer model misbehaves or is overloaded:** set `CHAT_ANSWER_MODEL` to another Gemini
  model (e.g. `gemini-3.8-flash`) and redeploy. Embeddings stay as they are. Run
  `pnpm eval:answers` on it when you can.
- **The balance is running out faster than expected:** top it up in AI Studio, and lower
  `CHAT_DAILY_LIMIT` (down to `1` while you look into it) and redeploy. Pausing new sign-ups
  (turn the allowlist back on) also helps. Uploads keep working while answers are limited, as
  long as some balance is left for embeddings (a fraction of a cent per document).
- **Never fall back to a free-tier key** once real users' documents are in: it would send them
  to a service that may use them.

## Optional: switch to the AI Gateway

Only if you want the gateway's models (`anthropic/claude-sonnet-5.5` for answers,
`openai/text-embedding-3-small` for embeddings), one bill across providers, or its fallbacks.
Nothing at launch needs it.

1. **Credits and a key.** Vercel dashboard → **AI Gateway** → **Credits** shows a balance (the
   gateway's free tier answers 403 for these models). For scripts run locally: **AI Gateway** →
   **API Keys** → **Create key**, kept in your shell (`export AI_GATEWAY_API_KEY=…`).
2. **Calibrate on `dev`.** With `export EMBEDDING_PROVIDER=gateway CHAT_PROVIDER=gateway`, run
   `corepack pnpm eval:retrieval`, set `EMBEDDING_CONFIGS.gateway.minSimilarity` in
   `src/server/ai/models.ts` between the lowest right-passage similarity and the highest
   off-topic one (it's still the 0.25 placeholder; replace its comment with the run's numbers
   and date), then run `eval:answers`, `eval:agent`, `eval:injection` and `eval:summary`.
   Compare each with its last Gemini run in `tests/evals/results/` (citation accuracy,
   grounding, honesty, task recall and precision, injection resistance), and commit the
   results, the summary JSON and the floor together as `chore(evals): gateway models, calibrated
floor`. Optionally `EMBEDDING_PROVIDER=gateway corepack pnpm db:backfill-embeddings` so `dev`
   matches.
3. **Set the daily limit.** `CHAT_DAILY_LIMIT` defaults to 50 on the gateway. Pick a number from
   the evals' `ai_usage` rows and set it in Vercel.
4. **Switch production.** In Vercel Production set `EMBEDDING_PROVIDER=gateway`,
   `CHAT_PROVIDER=gateway` and the limit; leave `AI_GATEWAY_API_KEY` unset (Vercel uses OIDC; a
   key always wins over OIDC). Keep `GOOGLE_GENERATIVE_AI_API_KEY` if you might switch back.
   Redeploy.
5. **Re-embed Neon `main` right after the deploy.** Until then, search skips the
   Gemini-embedded chunks and questions get "Your documents don't say…":

   ```bash
   export EMBEDDING_PROVIDER=gateway AI_GATEWAY_API_KEY=…
   export DATABASE_URL="$(neonctl connection-string main --project-id <neon-project> --pooled)"
   export DATABASE_URL_UNPOOLED="$(neonctl connection-string main --project-id <neon-project>)"
   corepack pnpm db:backfill-embeddings --dry-run   # counts the documents to re-embed
   corepack pnpm db:backfill-embeddings
   corepack pnpm db:backfill-embeddings --dry-run   # expect "0 ready document(s)"
   ```

   **How long:** documents go one at a time. Each takes one gateway request per 100 chunks
   (about 0.5 to 1.5 s), then one row update per chunk (a few ms each from a nearby machine, 20
   to 40 ms from far away). Count about **1 to 2 s per document plus 30 ms per chunk**: 100
   documents (about 2,000 chunks) take 3 to 5 minutes, 1,000 about half an hour. Real numbers
   first: `psql "$DATABASE_URL" -c "select count(distinct document_id) docs, count(*) chunks from chunk"`.
   Cost: about $0.02 per 2,000 chunks. Safe to stop and rerun: it only picks up chunks still on
   the old model.

6. **Smoke test** as in step 6, expecting `openai/text-embedding-3-small` and
   `anthropic/claude-sonnet-5.5` in the logs, and AI Gateway → **Usage** showing the requests.

**Switching back to Gemini** is the same in reverse: `EMBEDDING_PROVIDER=google`,
`CHAT_PROVIDER=google`, a paid-project key, redeploy, then the backfill with
`EMBEDDING_PROVIDER=google` (slower: one request every 0.7 s, 20 chunks each).
