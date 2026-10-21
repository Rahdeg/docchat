# DocChat

DocChat lets you upload your documents and ask questions about them in plain language. Every answer
is grounded in your files and cites the exact passages it came from, so you can check it instead of
trusting it. Later it will also turn conversations into tasks with an agent that acts on what you
discussed.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack, Cache Components), React 19, TypeScript
- [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com), Geist fonts
- Zod + [`@t3-oss/env-nextjs`](https://env.t3.gg) for env validation
- Planned: [Neon](https://neon.com) Postgres + Drizzle + pgvector, [Clerk](https://clerk.com)
  auth, [Vercel AI SDK](https://ai-sdk.dev) v7
- Tooling: pnpm, ESLint, Prettier, lefthook, Vitest, GitHub Actions

Architecture decisions are in [`docs/adr`](docs/adr). Conventions for contributors and coding agents
are in [`CLAUDE.md`](CLAUDE.md).

## Local setup

Requires Node.js 24+ and Git. pnpm is pinned in `package.json` and runs through Corepack, so you
don't need a global install.

```bash
# 1. Install dependencies (also installs the git hooks via lefthook)
corepack pnpm install

# 2. Create your local env file. Every variable is optional for now.
cp .env.example .env.local

# 3. Start the dev server at http://localhost:3000
corepack pnpm dev
```

Tip: run `corepack enable pnpm` once if you'd rather type `pnpm` without `corepack`.

## Scripts

| Script              | Description                                 |
| ------------------- | ------------------------------------------- |
| `pnpm dev`          | Start the dev server                        |
| `pnpm build`        | Production build (validates env)            |
| `pnpm start`        | Serve the production build                  |
| `pnpm lint`         | Run ESLint                                  |
| `pnpm typecheck`    | Generate route types and run `tsc --noEmit` |
| `pnpm format`       | Format with Prettier                        |
| `pnpm format:check` | Check formatting (used in CI)               |
| `pnpm test`         | Run unit tests with Vitest                  |
