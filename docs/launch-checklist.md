# Launch checklist: opening sign-ups

For the day the Vercel AI Gateway is funded. Until then DocChat runs on the Gemini free tier,
which is for fictional documents only (Google may use free-tier content), behind a Clerk
sign-up allowlist. Work through this list in order; each step says how to check it. Nothing here
has been done yet.

Placeholders: `<domain>` is the production domain (e.g. `docchat.app`), `<neon-project>` is the
Neon project id (`neonctl projects list`).

## 0. Before you start

- [ ] `main` is green in CI (both the `ci` and `e2e` jobs) and deployed.
- [ ] Migrations on Neon `main` are current:
      `DATABASE_URL_UNPOOLED="$(neonctl connection-string main --project-id <neon-project>)" corepack pnpm db:migrate`
      prints "migrations applied successfully" (or nothing to apply).
- [ ] Gateway credits are in place: Vercel dashboard → **AI Gateway** → **Credits** shows a
      balance. The gateway's free tier answers 403 for these models.
- [ ] Create an AI Gateway API key for the scripts you'll run locally: **AI Gateway** → **API
      Keys** → **Create key**. Keep it in your shell, not in a file you commit:
      `export AI_GATEWAY_API_KEY=…`.
- [ ] Check that `main` holds only fictional documents. Every document on it was embedded by
      the Gemini free tier, so nothing real should be there yet:
      `psql "$(neonctl connection-string main --project-id <neon-project>)" -c "select user_id, count(*) from document group by 1"`.

## 1. Calibrate the gateway models (on the `dev` branch)

The evals index their fixtures for an eval user on `DATABASE_URL` (the `dev` branch in
`.env.local`). Run each eval on the gateway models. The variables set in your shell win over
`.env.local`.

```bash
export EMBEDDING_PROVIDER=gateway CHAT_PROVIDER=gateway
corepack pnpm eval:retrieval     # embeddings only: cheap, about a minute
```

- [ ] Read the floor calibration at the end of the retrieval output: the lowest similarity of a
      right passage, and the highest of an off-topic question. Set
      `EMBEDDING_CONFIGS.gateway.minSimilarity` in `src/server/ai/models.ts` between them,
      closer to the off-topic maximum. It's still the 0.25 placeholder. Replace the comment
      above it with the run's numbers and date, as the Gemini entry has.
- [ ] Then the model evals, with the new floor in place (it decides which passages they see):

```bash
corepack pnpm eval:answers       # about 17 answers plus judge calls
corepack pnpm eval:agent         # 6 to 12 agent runs
corepack pnpm eval:injection     # about 15 runs
corepack pnpm eval:summary       # rewrites src/content/eval-summary.json
```

- [ ] Compare each eval with its last Gemini run in `tests/evals/results/`. Look at citation
      accuracy, grounding, honesty on no-answer questions, task recall and precision, and
      injection resistance. A drop needs a look before launch, not after.
- [ ] Commit the results files, the summary JSON and the `minSimilarity` change together:
      `git add tests/evals/results src/content/eval-summary.json src/server/ai/models.ts`, as
      `chore(evals): gateway models, calibrated floor`. The public "Measured, not promised"
      numbers come from these runs, so the landing page now shows the gateway's numbers.
- [ ] Optional, so `dev` matches production:
      `EMBEDDING_PROVIDER=gateway corepack pnpm db:backfill-embeddings` re-embeds the dev branch.

## 2. Copy changes (one PR)

- [ ] Raise the daily answer limit. `CHAT_DAILY_LIMIT` defaults to 50 on the gateway
      (`src/server/ai/limits.ts`). Pick the number from the cost per answer in the eval's
      `ai_usage` rows. Then set it in Vercel (step 3) rather than changing the default.
- [ ] Remove the free-tier wording users can see:
  - `FREE_LIMIT_MESSAGE` in `src/features/chat/message.ts` ("today's free AI limit"). Make it
    provider-neutral, e.g. "DocChat's AI service is busy right now. Try again in a few
    minutes.", and rename the constant (`chat-view.tsx` compares against it).
  - Comments and docs that tie limits to the free tier: `route.ts` ("the free tier's daily
    quota is shared by every user"), `limits.ts`, the README's "Answers setup" section, and the
    `CHAT_DAILY_LIMIT` note in `src/lib/env.ts`. Code comments are optional; anything a user
    reads is not.
  - Search for leftovers: `grep -rni "free tier\|free ai\|free limit" src`.
- [ ] Merge it, and let CI pass.

## 3. Switch production to the gateway (Vercel)

In the Vercel dashboard → the project → **Settings** → **Environment Variables**, for
**Production** (and **Preview**, if previews should match):

| Variable             | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `EMBEDDING_PROVIDER` | `gateway`                                                         |
| `CHAT_PROVIDER`      | `gateway`                                                         |
| `CHAT_DAILY_LIMIT`   | the number from step 2                                            |
| `AI_GATEWAY_API_KEY` | leave unset on Vercel (OIDC). If set, a key always wins over OIDC |

Remove `GOOGLE_GENERATIVE_AI_API_KEY` from Production, so nothing can fall back to the free
tier. Or with the CLI:

```bash
vercel env rm EMBEDDING_PROVIDER production && echo gateway | vercel env add EMBEDDING_PROVIDER production
vercel env rm CHAT_PROVIDER production && echo gateway | vercel env add CHAT_PROVIDER production
vercel env rm GOOGLE_GENERATIVE_AI_API_KEY production
```

- [ ] Redeploy production (**Deployments** → the latest → **Redeploy**, or
      `vercel --prod`). Env changes take effect only on a new deployment.
- [ ] **Re-embed every document on Neon `main` right after the deploy.** Until then, search
      skips the Gemini-embedded chunks and questions get "Your documents don't say…".

```bash
export EMBEDDING_PROVIDER=gateway AI_GATEWAY_API_KEY=…
export DATABASE_URL="$(neonctl connection-string main --project-id <neon-project> --pooled)"
export DATABASE_URL_UNPOOLED="$(neonctl connection-string main --project-id <neon-project>)"
corepack pnpm db:backfill-embeddings --dry-run   # counts the documents to re-embed
corepack pnpm db:backfill-embeddings
corepack pnpm db:backfill-embeddings --dry-run   # expect "0 ready document(s)"
```

**How long:** documents go one at a time. Each takes one gateway request per 100 chunks (about
0.5 to 1.5 s for `text-embedding-3-small`), then one row update per chunk (a few ms each from
a nearby machine, 20 to 40 ms from far away). Count about **1 to 2 s per document plus 30 ms
per chunk**. A dense 6-page document has about 16 chunks. So 100 documents (about 2,000
chunks) take 3 to 5 minutes, and 1,000 documents about half an hour. Get the real numbers
first:
`psql "$DATABASE_URL" -c "select count(distinct document_id) docs, count(*) chunks from chunk"`.
Cost is negligible: about 500 tokens per chunk at $0.02 per million tokens, about $0.02 per
2,000 chunks. The run is safe to stop and rerun: it only picks up chunks still on the old model.

## 4. Clerk production instance

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
      step 5 passes.

## 5. Sentry (if not already on)

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

## 6. Vercel Web Analytics and Speed Insights

- [ ] Vercel project → **Analytics** → **Enable**, and **Speed Insights** → **Enable**. The
      code already renders both on Vercel (cookie-free, same-origin `/_vercel/*`, nothing to add
      to the CSP). Data shows up after the next deployment gets visits.

## 7. Smoke test on production

Use a fresh browser profile on `https://<domain>`:

- [ ] `curl -s https://<domain>/api/health` → `{"status":"ok"}`.
- [ ] `/` loads signed out, with the eval numbers from step 1. Sign up with a new email (the
      allowlist is off now), then land on `/library`.
- [ ] Upload a short PDF: it reaches **Ready**. Vercel logs show
      `"event":"document.indexed"` with `"model":"openai/text-embedding-3-small"`.
- [ ] Ask a question it answers: a cited answer streams. Open the chip: the passage is
      highlighted, and "Open page" opens the PDF. The logs show `"event":"answer.generated"` with
      `"model":"anthropic/claude-sonnet-5.5"` and token counts.
- [ ] Ask something it doesn't cover: "Your documents don't say…".
- [ ] "Turn this into tasks" on an answer with deadlines: untick one, **Add**, and the tasks are
      on `/tasks`. Cancel on a second request adds nothing.
- [ ] Settings shows `https://<domain>/mcp`. Connect it from Claude
      (`claude mcp add --transport http docchat https://<domain>/mcp`) and search a document.
- [ ] Delete the test account (user menu → Manage account → Delete account). The webhook
      removes its rows and files: the Clerk webhook's log shows a 200 for `user.deleted`.
- [ ] AI Gateway → **Usage** shows the requests. Sentry shows no new issues.

## Rolling back

**If the problem is the deployment (code)**: Vercel → **Deployments** → the previous production
deployment → **Instant Rollback**. Env vars are not part of that rollback; they stay as set.

**If the problem is the gateway models**, the order matters.

- **Before sign-ups open** (allowlist still on, only fictional documents): set
  `EMBEDDING_PROVIDER=google` and `CHAT_PROVIDER=google`, put `GOOGLE_GENERATIVE_AI_API_KEY`
  back, and redeploy. Then re-embed with Gemini, the same backfill as step 3 with
  `EMBEDDING_PROVIDER=google` and the Gemini key. Search ignores the gateway vectors until that
  runs, and Gemini's free tier embeds slowly (one request every 0.7 s, 20 chunks each). Revert
  the `minSimilarity` and eval commits only if you're abandoning the gateway.
- **After sign-ups open, never switch back to the Gemini free tier**: it would send real users'
  documents and questions to a service that may use them. Use one of these instead:
  - Change only the answer model on the gateway: `CHAT_ANSWER_MODEL=<another gateway model id>`
    and redeploy. Embeddings stay as they are.
  - Or pause new sign-ups (turn the allowlist back on), and if needed set
    `CHAT_DAILY_LIMIT=1` while you fix it. Uploads keep working: indexing only needs the
    embedding model.
