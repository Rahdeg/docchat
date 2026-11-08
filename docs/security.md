# Security

How DocChat checks who's calling, the safety measures around it, and the settings outside the
code (Clerk dashboard, deploy). Decisions are in `docs/adr/0002` (Clerk), `0007` (agent approval)
and `0008` (MCP and safety).

## Authorization audit

Every entry point and how it finds the user. `src/server/authorization-audit.test.ts` keeps this
honest: it fails if a `"use server"` file exports anything not built with `authedAction`, if a
route handler isn't listed there with its check, or if the MCP handler stops requiring a token.

The proxy (`src/proxy.ts`) only redirects; it is never the check. Public to it (`isPublicPath`,
`src/lib/routes.ts`): `/`, `/how-we-test`, `/sign-in`, `/sign-up`, `/mcp`, `/.well-known/*`, and
the files crawlers and link previews fetch (`/robots.txt`, `/sitemap.xml`, `/opengraph-image`,
`/apple-icon`). None of those show user data. It leaves `/api/*` alone, so routes answer 401
themselves. Signed-in visitors to `/` are redirected to `/library` by the proxy, so the landing
page itself never reads the session and stays static.

Clerk's browser SDK loads only where `ClerkProvider` is: the `(app)` and `(auth)` groups
(`AuthProvider`, `src/components/auth-provider.tsx`). The public and error pages run no Clerk
JavaScript; server-side checks (`auth()`, `verifyMcpToken`, `verifyWebhook`) read the request
and don't depend on it. Signed-in pages are `noindex`, and `robots.txt` disallows them.

### Route handlers

| Route                                           | Who can call it                                  | How the user is checked                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/chat`                                | The signed-in user                               | `auth()`; 401 without a session. The chat must be theirs (`ensureChat`: another user's chat id is a 404). Daily limit and search rate limit before any model call.                                                                                     |
| `POST /api/documents/upload`                    | The signed-in user                               | `auth()`; 401 without a session. The Blob path must be in `users/<their id>/` (`checkUploadPath`). Upload rate limit per token.                                                                                                                        |
| `PUT /api/documents/upload/local`               | The signed-in user                               | Only with `STORAGE_DRIVER=local`, a test double for CI's e2e tests (refused outside tests and CI); 404 otherwise. `auth()`; 401 without a session. Same checks as the token route: `checkUploadPath`, type, size, upload rate limit. Never overwrites. |
| `GET /api/documents/[id]/file`                  | The document's owner                             | `auth()`; 401 without a session, 404 for someone else's document. `Cache-Control: private, no-cache`.                                                                                                                                                  |
| `POST /api/webhooks/clerk`                      | Clerk                                            | `verifyWebhook` with `CLERK_WEBHOOK_SIGNING_SECRET` (signature and timestamp); 400 otherwise. No session.                                                                                                                                              |
| `GET/POST /mcp`                                 | A connected AI app, for the user who approved it | `withMcpAuth` + `verifyMcpToken`: a Clerk OAuth access token whose audience is exactly `<APP_URL>/mcp`, with the `profile` scope. 401 or 403 otherwise; 503 when `MCP_ENABLED=false`.                                                                  |
| `GET /.well-known/oauth-protected-resource/mcp` | Anyone                                           | Public by design (RFC 9728): the resource URL, Clerk as authorization server, supported scopes. No user data.                                                                                                                                          |
| `GET /.well-known/oauth-authorization-server`   | Anyone                                           | Public by design (RFC 8414): Clerk's metadata, fetched from Clerk. No user data.                                                                                                                                                                       |
| `POST /monitoring` (`src/app/sentry-tunnel`)    | Anyone                                           | Public by design: Sentry's tunnel. Forwards error reports to Sentry for our own DSN only (403 otherwise, 413 over 20 MiB). Reports are scrubbed before they leave the browser. No user data read.                                                      |
| `GET /api/health`                               | Anyone                                           | Public by design: a database ping (`select 1`) for the Docker `HEALTHCHECK` and uptime checks. `{"status":"ok"}` or a 503 `{"status":"error"}`; no versions, hosts or error text. `no-store`.                                                          |

### Server Actions

All are `authedAction(schema, handler)` (`src/lib/action.ts`): `auth()` first, then Zod, and the
handler gets `userId` from the session only. Every query and mutation they call filters by it.

| Action                                                                | File                                | Extra checks                                                                                |
| --------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `registerDocument`                                                    | `src/features/documents/actions.ts` | Path in the user's folder, real size and leading bytes of the stored file, 20-document cap. |
| `retryDocument`, `deleteDocument`                                     | `src/features/documents/actions.ts` | The document must be the user's.                                                            |
| `uploadLimitReason`                                                   | `src/features/documents/actions.ts` | Reads the user's own upload count; counts nothing.                                          |
| `renameChat`, `deleteChat`, `rateAnswer`                              | `src/features/chat/actions.ts`      | The chat or message must be the user's.                                                     |
| `createTask`, `updateTask`, `toggleTask`, `deleteTask`, `restoreTask` | `src/features/tasks/actions.ts`     | The task must be the user's; `restoreTask` keeps links only to rows the user still owns.    |

Agent tasks are written only by `answerProposal` (`src/features/tasks/agent-tasks.ts`), reached
through `POST /api/chat` with an approval, never from a model's tool call (`docs/adr/0007`).

### Pages

`/library`, `/chat`, `/chat/[chatId]`, `/tasks` and `/settings` call `requireUserId()` inside
`<Suspense>` and pass the id to the feature query; each sidebar section does the same.

### MCP tools

Every tool runs through `runTool` (`src/server/mcp/server.ts`): the user id comes from the
verified token (`userIdFrom(authInfo)`), never from tool input (Zod drops unknown keys, and no
input schema has a user field). Each call counts against the MCP rate limit first.

| Tool               | Read-only | What it touches                                                                                                                                                              |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_documents`   | yes       | The user's documents (`listDocuments(userId)`).                                                                                                                              |
| `search_documents` | yes       | The user's ready documents (`searchPassages` with `userId`, `MIN_SIMILARITY`); `documentIds` only narrows within them. One embedding, `mcp-search`. Also counts as a search. |
| `list_tasks`       | yes       | The user's tasks (`listTasks(userId)`).                                                                                                                                      |
| `create_task`      | no        | Inserts a task for the user, `createdBy: "mcp"`. A source is kept only if the document is the user's and ready and the quote is found in it.                                 |
| `complete_task`    | no        | Marks one of the user's tasks done (`setTaskDone(userId, id)`); someone else's id is "not found".                                                                            |

## Safety measures

- **Account deletion.** Clerk's `user.deleted` webhook deletes all the user's rows in one
  transaction, then every file in their Blob folder (`src/server/account.ts`). Idempotent; a
  failure answers 500 and Clerk retries.
- **Security headers** (`src/lib/security-headers.ts`, sent by `next.config.ts` on every route):
  an enforced Content-Security-Policy, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy` and HSTS. The policy:
  - `default-src 'self'`; scripts from ourselves, Clerk's Frontend API host (read from the
    publishable key), Cloudflare's challenge and Clerk's protection hosts; `'unsafe-inline'`
    for scripts and styles (no nonce, see ADR 0008); `'unsafe-eval'` only under `next dev`.
  - `connect-src`: ourselves, Clerk, `*.protect.clerk.com:*`, `https://vercel.com/api/blob/`
    (browser uploads), and Clerk's telemetry only with a development key. Sentry reports and
    Vercel Analytics are same-origin (`/monitoring`, `/_vercel/*`), so they need no host.
  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
    `upgrade-insecure-requests` in production.
  - Fonts are self-hosted by `next/font`, so no Google Fonts hosts. Stored files are served by
    our own route, so no Blob hosts for reading.
  - **Escape hatch:** `CSP_REPORT_ONLY=1` sends the policy as
    `Content-Security-Policy-Report-Only` (the browser console reports, nothing is blocked)
    while `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` stay
    enforced. It's read when the config loads, so set it in Vercel and redeploy. Use it only to
    find what a new third party needs, then add that host and turn it off.
  - Checked by `pnpm test:e2e` (`tests/e2e/security.spec.ts`, and `signed-in.spec.ts` with a
    Clerk test user) against a production build: no CSP violations on any page.
- **Rate limits** (`src/lib/rate-limits.ts`, enforced by `src/server/rate-limit.ts` in Postgres):

  | Limit               | Per user       | Where                                                            |
  | ------------------- | -------------- | ---------------------------------------------------------------- |
  | Questions (answers) | 10 or 50 a day | `POST /api/chat`, `CHAT_DAILY_LIMIT` (`src/server/ai/limits.ts`) |
  | Searches            | 30 a minute    | `POST /api/chat` questions and MCP `search_documents`            |
  | Uploads             | 20 an hour     | `POST /api/documents/upload` (or `/upload/local`), one per file  |
  | MCP calls           | 60 a minute    | Every MCP tool call                                              |

  Each refusal is a 429 (or an MCP error result) saying when to try again.

- **Monitoring without personal data** (`docs/adr/0009`). Sentry runs only with `SENTRY_DSN`,
  for errors only. It never receives document text, passages, prompts, answers, file names,
  emails, headers, cookies, request bodies or query strings. The Clerk user id is the only
  identifier (`src/lib/monitoring.ts`: `dataCollection` off, AI/console/Zod integrations
  dropped, an allowlist `beforeSend` that scrubs messages; `monitoring.test.ts` checks it).
  Server logs are typed JSON events with fixed fields (`src/server/log.ts`), never free text.
  Vercel Web Analytics and Speed Insights are cookie-free and run only on Vercel.
- **Test doubles never reach production.** The fake AI providers and the local file store
  (`EMBEDDING_PROVIDER=fake`, `CHAT_PROVIDER=fake`, `STORAGE_DRIVER=local`) are rejected by env
  validation unless `NODE_ENV=test` or `CI` is set, and never on Vercel. The server also refuses
  to start with them (`src/instrumentation.ts`), even with validation skipped.
- **Prompt injection.** Document text reaches a model only as marked, untrusted data: in
  `<source>` blocks for our answer model (`prompts.ts`), and in `<document_content
untrusted="true">` blocks under a notice for a connected app's model (`src/server/mcp/content.ts`),
  with look-alike tags escaped in both. The agent's tools turn on only from the user's own words,
  proposals need the user's approval, and MCP writes are marked not read-only so clients ask
  first. `pnpm eval:injection` tests seven hostile documents against all of this.
- **Dependencies.** CI runs `pnpm audit --prod --audit-level=high`; Dependabot opens weekly
  grouped updates for npm and GitHub Actions (`.github/dependabot.yml`). Overrides in
  `pnpm-workspace.yaml` patch two transitive advisories until upstream does.

## Clerk dashboard

Make these changes on the **development** instance for local work and again on the
**production** instance before launch. The code doesn't change any of them.

1. **MCP server.** Agents → MCP servers → **Add MCP server** (or **Get started**). MCP URL:
   `http://localhost:3000/mcp` on development; `https://<your domain>/mcp` on production,
   exactly as `APP_URL` + `/mcp` (no trailing slash). Select **Allow public clients to connect**.
2. **Audience claims.** `verifyMcpToken` refuses any token without `aud`, and Clerk only adds
   `aud` (from the client's RFC 8707 `resource`) when the instance's OAuth application settings
   have `aud_claim_enabled` on. Adding the MCP server doesn't turn it on. Set it, and
   `aud_claim_refresh_backfill_enabled` so refreshed tokens of older grants get `aud` too,
   through the Backend API with that instance's secret key:

   ```sh
   curl -X PATCH https://api.clerk.com/v1/instance/oauth_application_settings \
     -H "Authorization: Bearer $CLERK_SECRET_KEY" -H "Content-Type: application/json" \
     -d '{"aud_claim_enabled": true, "aud_claim_refresh_backfill_enabled": true}'
   ```

   Read it back with a `GET` on the same URL. Without it, sign-in succeeds but every `/mcp`
   request answers 401 and the client loops back to the metadata. Apps connected before the
   change sign in again.

3. **OAuth applications → Settings → Client onboarding.**
   - **Publish CIMD support:** on. Claude, Cursor and VS Code identify themselves with a Client
     ID Metadata Document.
   - **Publish DCR support:** off. It opens a public endpoint that anyone can register clients
     with. Turn it on only if a client you need supports nothing else.
   - **Default scopes for dynamic clients:** `profile offline_access`. Some clients (Claude,
     ChatGPT) send no scope; `profile` is what `/mcp` requires, and `offline_access` lets the app
     refresh its token instead of asking the user to sign in again. Don't add `email`: the tools
     don't need it.
   - Keep the consent screen on (it is always on for CIMD clients).
4. **Account deletion.** User & authentication → **Allow users to delete their accounts**: on,
   so the Delete account button shows in the profile (Settings → Manage account).
5. **Webhook.** Webhooks → **Add endpoint**: `https://<your domain>/api/webhooks/clerk`,
   subscribed to **`user.deleted`** only. Copy its **Signing Secret** (`whsec_…`) into
   `CLERK_WEBHOOK_SIGNING_SECRET`. For local testing, `clerk webhooks listen --forward-to
http://localhost:3000/api/webhooks/clerk` relays events to your machine (use that relay
   endpoint's secret locally).

## Deploy

1. Env vars on Vercel (Production): `CLERK_WEBHOOK_SIGNING_SECRET` (required),
   `APP_URL=https://<your domain>` (defaults to the project's production domain),
   `MCP_ENABLED` (default `true`), `CSP_REPORT_ONLY` (leave unset).
2. `pnpm db:migrate` against `main` before deploying (migration 0008).
3. Do the Clerk dashboard steps above on the production instance.
4. After deploying: the Clerk dashboard's MCP server page re-tests the connection; connect
   Claude Desktop (Customize → Connectors → Add custom connector) to `https://<your domain>/mcp`;
   delete a throwaway account and check its rows are gone.
