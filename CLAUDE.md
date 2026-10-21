# DocChat

Users upload documents and ask questions; answers come back with cited sources (RAG). A later
phase adds an agent that creates tasks from conversations.

Next.js-specific agent rules live in AGENTS.md (generated and kept up to date by `next dev`). Read it;
don't duplicate or hand-edit the managed block:

@AGENTS.md

## Stack

- Next.js 16 (App Router, `src/`, Turbopack, Cache Components on), React 19, TypeScript strict
- Tailwind CSS v4 (CSS-first config in `src/app/globals.css`, no `tailwind.config`)
- shadcn/ui (`base-nova` style, Base UI primitives), Geist + Geist Mono via the `geist` package
- Zod 4 + `@t3-oss/env-nextjs` for env validation
- Neon Postgres (project `docchat`, `aws-eu-central-1`) + Drizzle ORM + pgvector, via
  node-postgres (`pg`)
- Planned: Clerk (`@clerk/nextjs`), Vercel AI SDK v7
- Data flow: Server Components for reads, Server Actions for writes (no tRPC, see
  `docs/adr/0001`), one route handler for chat streaming
- Tooling: pnpm (pinned via `packageManager`), ESLint 9 flat config, Prettier, lefthook, Vitest

## Commands

pnpm is pinned per project and not installed globally. Run it through Corepack (`corepack pnpm <cmd>`),
or run `corepack enable pnpm` once if you want a bare `pnpm`.

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `pnpm dev`          | Dev server (Turbopack)                           |
| `pnpm build`        | Production build (also validates env)            |
| `pnpm start`        | Serve the production build                       |
| `pnpm lint`         | ESLint (`next lint` no longer exists in Next 16) |
| `pnpm typecheck`    | `next typegen` then `tsc --noEmit`               |
| `pnpm format`       | Prettier write                                   |
| `pnpm format:check` | Prettier check (CI)                              |
| `pnpm test`         | Vitest, single run                               |
| `pnpm db:generate`  | Generate a SQL migration from the schema         |
| `pnpm db:migrate`   | Apply pending migrations (direct connection)     |
| `pnpm db:studio`    | Drizzle Studio against `DATABASE_URL_UNPOOLED`   |
| `pnpm db:seed`      | Reset and insert sample data (development only)  |

Before you call a change done: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

## Folder conventions

```
src/app/(auth)/        sign-in / sign-up routes (Clerk)
src/app/(app)/         authenticated app routes
src/components/ui/     shadcn-generated. Do not hand-edit.
src/components/        shared app components built on ui/
src/features/<name>/   feature modules: documents, chat, tasks (components, actions, schemas,
                       queries.ts for user-scoped reads)
src/server/db/         Drizzle client (index.ts) and schema/ (one file per area)
src/server/ai/         AI SDK setup, retrieval, prompts, tools (server-only)
src/lib/               framework-agnostic utilities (cn, env)
src/proxy.ts           route protection (Next 16 replaces middleware.ts); added in the auth PR
docs/adr/              architecture decision records
drizzle/               generated SQL migrations and snapshots (committed)
scripts/               standalone scripts run with tsx (seed)
tests/e2e/             end-to-end tests
```

Unit tests sit next to the code as `*.test.ts(x)`.

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
- Use theme tokens (`bg-background`, `text-muted-foreground`, `bg-highlight` for citations), not
  raw colours.
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
- `EMBEDDING_DIMENSIONS` in `src/server/ai/constants.ts` must match the embedding model. Changing
  it needs a migration and re-embedding; a unit test fails if the migration is missing.
- Scripts and drizzle-kit run with `--conditions=react-server` so `server-only` imports resolve
  outside Next. The `db:*` scripts already do this.
- Integration tests (`*.integration.test.ts`) use `describe.skipIf(!process.env.DATABASE_URL)` and
  import database modules lazily. CI has no database and sets `SKIP_ENV_VALIDATION`.

## Auth rules (Clerk)

- Auth uses `@clerk/nextjs`. Clerk is the decided provider (`docs/adr/0002`), even before
  it's installed. Treat the project as having an existing provider (Clerk).
- Never use Neon Auth or Better Auth (managed or self-hosted). The `neon` skills send login work
  to `neon-auth` and say to fetch it from neon.com; don't install or fetch it. We removed it
  on purpose. Skip their auth, `NEON_AUTH_*` and "Managed Better Auth" examples too.
- Route protection lives in `src/proxy.ts` (`clerkMiddleware` exported as the proxy). There is no
  `middleware.ts` in Next 16.
- Proxy checks are only optimistic. Every Server Action calls `auth()` and rejects when there
  is no `userId`, before doing anything else.
- Tables store Clerk's `userId` as `text`. There is no local `users` table; profile data stays in
  Clerk.

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
