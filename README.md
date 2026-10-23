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
- Planned: [Vercel AI SDK](https://ai-sdk.dev) v7
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

### See sample data for your own account

1. Start the app, sign up, and copy your user ID (`user_…`) from the Clerk dashboard under **Users**.
2. Seed sample documents, a chat and tasks for that user:

   ```bash
   corepack pnpm db:seed --user user_xxxxxxxx
   # or: SEED_USER_ID=user_xxxxxxxx corepack pnpm db:seed
   ```

   This first deletes any existing data for that user in your dev database. Without `--user` it
   seeds a placeholder user (`user_seed_dev`) you can't sign in as.

3. Reload `/library`.

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
| `pnpm test:e2e`     | Run Playwright end-to-end tests (local)     |
| `pnpm db:generate`  | Generate a SQL migration from the schema    |
| `pnpm db:migrate`   | Apply pending migrations                    |
| `pnpm db:studio`    | Open Drizzle Studio                         |
| `pnpm db:seed`      | Reset and insert sample data (dev only)     |

## Testing

- `pnpm test` runs the unit tests. Integration tests (`*.integration.test.ts`) also run when
  `DATABASE_URL` is set, and skip themselves otherwise (as in CI).
- `pnpm test:e2e` runs Playwright against `pnpm dev`. It reuses a dev server that's already running,
  or starts one. To test a production build, run `pnpm build && pnpm start` and set
  `E2E_BASE_URL=http://localhost:3000`. It needs the Clerk keys in `.env.local`. The first time,
  run `corepack pnpm exec playwright install chromium`.
- **E2E tests don't run in CI yet.** CI runs typecheck, lint, format check, unit tests and the build.
