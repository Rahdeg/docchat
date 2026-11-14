# Launch checklist: opening sign-ups

DocChat launches on the Gemini API's paid tier (`EMBEDDING_PROVIDER=google`,
`CHAT_PROVIDER=google`, the defaults; `docs/adr/0005` amendment). On the paid tier Google doesn't
use prompts or responses to improve its products, so real documents are fine. Until sign-ups
open, a Clerk sign-up allowlist keeps the app to invited users. The Vercel AI Gateway is
optional: see "Optional: switch to the AI Gateway" at the end. Work through this list in order;
each step says how to check it.

The production domain is **`docchat.raheem.online`**, served by Clerk's **production** instance.
Placeholder: `<neon-project>` is the Neon project id (`neonctl projects list`).

## Production domain

Every setting that must name `docchat.raheem.online`, in one place. The code reads the domain
only from env (`APP_URL`, and the Clerk host inside the publishable key); nothing in it is
hardcoded. The steps below point back here.

### DNS (at the host for `raheem.online`)

| Record                                              | Type  | Value                                                  |
| --------------------------------------------------- | ----- | ------------------------------------------------------ |
| `docchat`                                           | CNAME | the target Vercel shows for the domain (Vercel step 1) |
| `clerk.docchat`                                     | CNAME | `frontend-api.clerk.services` (as Clerk lists it)      |
| `accounts.docchat`                                  | CNAME | `accounts.clerk.services`                              |
| `clkmail.docchat`                                   | CNAME | the `mail.….clerk.services` value Clerk lists          |
| `clk._domainkey.docchat`, `clk2._domainkey.docchat` | CNAME | the DKIM values Clerk lists                            |

Copy the values from the dashboards, not from this table. On Cloudflare DNS, set the Clerk
records to **DNS only** (grey cloud): Clerk can't issue its certificates behind the proxy.

- [ ] Check: `dig +short docchat.raheem.online` and `dig +short clerk.docchat.raheem.online CNAME`
      both answer.

### Vercel (the project → Settings)

1. [ ] **Domains** → **Add**: `docchat.raheem.online`, environment **Production**, no redirect.
       Add the DNS record it shows; wait for **Valid Configuration** and the certificate.
2. [ ] **Environment Variables**, **Production** only:

   | Variable                            | Value                                                 |
   | ----------------------------------- | ----------------------------------------------------- |
   | `APP_URL`                           | `https://docchat.raheem.online` (no trailing slash)   |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the production instance's `pk_live_…`                 |
   | `CLERK_SECRET_KEY`                  | the production instance's `sk_live_…` (sensitive)     |
   | `CLERK_WEBHOOK_SIGNING_SECRET`      | the production webhook endpoint's `whsec_…` (Clerk 5) |

   `APP_URL` gives the metadata (`metadataBase`, so the Open Graph image's absolute URL),
   `sitemap.xml`, `robots.txt`, the landing page's Claude Code command, the Settings card and
   the MCP resource URL (`<APP_URL>/mcp`, the OAuth audience). The publishable key names
   `clerk.docchat.raheem.online`, which is what the CSP allows (`src/lib/security-headers.ts`);
   there is no CSP variable to set. Leave `CSP_REPORT_ONLY` unset.

   **Preview** and **Development** keep the development instance's `pk_test_`/`sk_test_` keys
   and webhook secret, and leave `APP_URL` unset. (Unset, it falls back to Vercel's production
   domain, which is `docchat.raheem.online` once it's added, so previews show the production
   MCP URL, as `docs/adr/0008` intends.)

3. [ ] **Redeploy** production. The keys, `APP_URL` and the CSP are built into the deployment, so
       they change only on a new build.
4. [ ] **Deployment Protection**: the production domain must stay public. Claude connects to
       `/mcp` from its own servers, and crawlers fetch `/robots.txt` and `/opengraph-image`.
5. [ ] The project's `*.vercel.app` production URL still answers, but Clerk's production instance
       works only on `docchat.raheem.online`, so sign-in fails there. Optional: **Domains** →
       that domain → **Edit** → redirect (308) to `docchat.raheem.online`.

### Clerk (the production instance)

1. [ ] **Domains**: application domain `docchat.raheem.online`. That makes the Frontend API
       `clerk.docchat.raheem.online` and the Account Portal `accounts.docchat.raheem.online`.
       Add Clerk's DNS records (above) and wait until each shows **Verified** and the
       certificates are issued.
2. [ ] **Paths** (Configure → Developers → Paths): sign-in `/sign-in`, sign-up `/sign-up`, and
       after sign-out `/`, all on the application domain. Clerk's emails and the Account Portal
       link back through these.
3. [ ] **SSO connections**, for each social provider offered, in that provider's OAuth app: - Google Cloud → **Credentials** → the OAuth client: **Authorized JavaScript origins**
       `https://docchat.raheem.online`; **Authorized redirect URIs** the URI Clerk shows
       (`https://clerk.docchat.raheem.online/v1/oauth_callback`). **OAuth consent screen** →
       authorized domain `raheem.online`, home page `https://docchat.raheem.online`. - GitHub → **Developer settings** → the OAuth app: homepage
       `https://docchat.raheem.online`, callback URL the one Clerk shows (same as above).
4. [ ] **MCP server** (Agents → MCP servers): `https://docchat.raheem.online/mcp`, exactly
       `APP_URL` + `/mcp`, no trailing slash. Then the rest of `docs/security.md` → "Clerk
       dashboard" with `sk_live_…`: `aud_claim_enabled`, CIMD on, DCR off, default scopes.
5. [ ] **Webhooks** → endpoint `https://docchat.raheem.online/api/webhooks/clerk`, `user.deleted`
       only; its signing secret goes into Vercel Production (Vercel step 2).
6. [ ] **API keys**: the `pk_live_…`/`sk_live_…` pair for Vercel step 2. Check the publishable key
       names the right host:
       `node -e 'console.log(Buffer.from(process.argv[1].slice(8),"base64").toString())' pk_live_…`
       prints `clerk.docchat.raheem.online$`.

### Elsewhere

- [ ] **Sentry** → Project Settings → General → **Allowed Domains**: `docchat.raheem.online`
      (step 4).

### Check after the redeploy

```bash
curl -sI https://docchat.raheem.online | grep -i '^content-security-policy' | tr ';' '\n' | grep clerk
# script-src and connect-src list https://clerk.docchat.raheem.online, and no clerk.accounts.dev
curl -s https://docchat.raheem.online/robots.txt | grep -i sitemap
# Sitemap: https://docchat.raheem.online/sitemap.xml
curl -s https://docchat.raheem.online/sitemap.xml | grep -o '<loc>[^<]*'
curl -s https://docchat.raheem.online | grep -o '<meta property="og:image" content="[^"]*'
# https://docchat.raheem.online/opengraph-image…
curl -s https://docchat.raheem.online/.well-known/oauth-protected-resource/mcp
# "resource":"https://docchat.raheem.online/mcp", authorization server https://clerk.docchat.raheem.online
```

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

The free-tier limits (`src/lib/limits.ts`, `docs/adr/0010`): **30 questions** per user per UTC
day (5 a minute), **5 task requests** (up to five model calls each) and **2,000 questions** a
day across everyone, the global breaker.

- [ ] Check the cost against the balance. A typical answer is about $0.003 now and $0.007 from
      1 January 2027, when `gemini-3.6-flash` doubles in price; a long one up to $0.04. So one
      user's 30 questions and 5 task requests (at most about 55 calls) cost about $0.20 a day
      ($0.40 from 2027), and the 2,000-question breaker caps everyone at roughly $6–14 a day. The real
      numbers: `psql "$DATABASE_URL" -c "select model, count(*), avg(input_tokens), avg(output_tokens) from ai_usage where kind = 'chat' group by 1"`.
- [ ] Size the breaker to the balance: it lasts at least balance ÷ (breaker × cost per answer)
      days. Top up before opening sign-ups widely, or set a lower `GLOBAL_QUESTIONS_PER_DAY` or
      `QUESTIONS_PER_DAY` in Vercel Production (no code change, just a redeploy).
- [ ] Set `UNLIMITED_USER_IDS` to your own **production** Clerk user id (Clerk dashboard →
      production instance → Users), for demos. The global breaker still applies to you.
- [ ] Optional: re-run the evals for fresh public numbers (the models haven't changed, so the
      current ones still hold). A full run of all four costs well under $1:
      `corepack pnpm eval:retrieval && corepack pnpm eval:answers && corepack pnpm eval:agent && corepack pnpm eval:injection && corepack pnpm eval:summary`,
      then commit `tests/evals/results` and `src/content/eval-summary.json`.

## 2. Production environment (Vercel)

In the Vercel dashboard → the project → **Settings** → **Environment Variables**, for
**Production** (and **Preview**, if previews should match):

| Variable                       | Value                                     |
| ------------------------------ | ----------------------------------------- |
| `EMBEDDING_PROVIDER`           | `google` (or unset: it's the default)     |
| `CHAT_PROVIDER`                | `google` (or unset)                       |
| `GOOGLE_GENERATIVE_AI_API_KEY` | a key from the paid project (step 0)      |
| `UNLIMITED_USER_IDS`           | your production Clerk user id (step 1)    |
| Limits (`.env.example`)        | unset for the defaults in `docs/adr/0010` |
| `AI_GATEWAY_API_KEY`           | unset (only for the optional gateway)     |

- [ ] Redeploy production (**Deployments** → the latest → **Redeploy**, or
      `vercel --prod`). Env changes take effect only on a new deployment.
- [ ] Nothing to re-embed: production already uses `google/gemini-embedding-001`, and the paid
      tier serves the same model.

## 3. Clerk production instance

- [ ] Clerk dashboard → the application → instance switcher (top) → **Create production
      instance** (clone the development settings).
- [ ] Work through "Production domain" above: DNS, then Clerk 1 to 6, then Vercel 1 to 5. Keep
      the `pk_test_`/`sk_test_` keys in Preview and Development, and in the GitHub secrets for CI
      (the e2e job signs in to the development instance).
- [ ] **SSO connections**: the development instance uses Clerk's shared OAuth credentials; the
      production instance needs your own (Clerk 3 above has the URLs).
- [ ] **Remove the sign-up allowlist**: production instance → **Configure** → **Restrictions** →
      **Allowlist** → off. Keep the blocklist and bot protection on. Do this last, after
      step 6 passes.

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
- [ ] **Project Settings** → **General** → **Allowed Domains**: `docchat.raheem.online`, plus the Vercel
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

Use a fresh browser profile on `https://docchat.raheem.online`:

- [ ] `curl -s https://docchat.raheem.online/api/health` → `{"status":"ok"}`.
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
- [ ] Settings shows `https://docchat.raheem.online/mcp`. Connect it from Claude
      (`claude mcp add --transport http docchat https://docchat.raheem.online/mcp`) and search a document.
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
  `GLOBAL_QUESTIONS_PER_DAY` (down to a few dozen while you look into it) and redeploy. Pausing new sign-ups
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
3. **Check the limits.** The question limits (`docs/adr/0010`) were sized for Gemini's prices.
   From the evals' `ai_usage` rows, work out the gateway's cost per answer and set
   `QUESTIONS_PER_DAY` and `GLOBAL_QUESTIONS_PER_DAY` in Vercel to match.
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
