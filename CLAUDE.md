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
- Planned: Neon Postgres + Drizzle + pgvector, Clerk (`@clerk/nextjs`), Vercel AI SDK v7
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

Before you call a change done: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

## Folder conventions

```
src/app/(auth)/        sign-in / sign-up routes (Clerk)
src/app/(app)/         authenticated app routes
src/components/ui/     shadcn-generated. Do not hand-edit.
src/components/        shared app components built on ui/
src/features/<name>/   feature modules: documents, chat, tasks (components, actions, schemas)
src/server/db/         Drizzle schema, client, queries (server-only)
src/server/ai/         AI SDK setup, retrieval, prompts, tools (server-only)
src/lib/               framework-agnostic utilities (cn, env)
src/proxy.ts           route protection (Next 16 replaces middleware.ts); added in the auth PR
docs/adr/              architecture decision records
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
- Read env through `env` from `@/lib/env`, never `process.env` directly.
- Before writing UI, check the installed skills (`shadcn`, `vercel-react-best-practices`) and the
  shadcn MCP server (`.mcp.json`) for an existing component or pattern.
- Before writing Next.js, AI SDK, Clerk or Neon code, read the matching skill in `.claude/skills/`.
- Use theme tokens (`bg-background`, `text-muted-foreground`, `bg-highlight` for citations), not
  raw colours.
- Make small, focused commits with Conventional Commit messages (`feat:`, `fix:`, `chore:`,
  `docs:`, `refactor:`, `test:`, `ci:`). The pre-commit hook lints and formats staged files.

## Auth rules (Clerk)

- Auth uses `@clerk/nextjs`. Clerk is the decided provider (`docs/adr/0002`). Ignore the
  Neon Auth / Better Auth suggestions in the Neon skills.
- Route protection lives in `src/proxy.ts` (`clerkMiddleware` exported as the proxy). There is no
  `middleware.ts` in Next 16.
- Proxy checks are only optimistic. Every Server Action calls `auth()` and rejects when there
  is no `userId`, before doing anything else.
- Every query filters by `userId`. No unscoped reads or writes on user data.
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
