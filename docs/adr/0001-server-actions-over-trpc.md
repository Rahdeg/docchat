# ADR 0001: Server Actions over tRPC

- Status: Accepted
- Date: 2026-10-21

## Context

DocChat is a single Next.js 16 App Router app with one client: the web UI. It needs typed reads
(document lists, chat history, tasks), typed writes (upload, delete, create task), and one
streaming endpoint for chat.

Next.js offers Server Components for reads and Server Actions for writes. Both are typed end to end
through ordinary TypeScript imports. tRPC would add a router, a client, a React Query layer and a
route handler on top of features the framework already provides.

## Decision

- **Reads:** Server Components call server-only query functions in `src/server/` directly.
- **Writes:** Server Actions, colocated in `src/features/<name>/`. Each one validates input with
  Zod, calls `auth()`, and scopes all work to `userId`.
- **Streaming:** one route handler for chat, using the Vercel AI SDK.
- No tRPC and no general-purpose REST layer.

## Consequences

Good:

- Less code and fewer dependencies. Types flow through imports, with no codegen and no client setup.
- Works with Cache Components, `revalidatePath`/`revalidateTag`, forms and progressive enhancement.
- Auth and validation follow one pattern (Zod parse, then `auth()`, then query by `userId`).

Bad:

- Server Actions are public POST endpoints. Every action must do its own auth and validation; the
  framework won't enforce it. CLAUDE.md makes this a rule.
- No built-in request batching or client cache like React Query. We rely on Next's caching and
  revalidation instead.
- Only our own Next.js frontend can call the API in a structured way.

## When we would revisit

- A second client, such as a mobile app or browser extension, needs the same operations.
- We want to offer a public or partner API.
- Client-side data needs (heavy optimistic updates, polling, offline) outgrow what Server Actions
  and Next caching can do cleanly.

If that happens, move the query and mutation logic in `src/server/` behind tRPC or a versioned
REST API. Keeping the logic in `src/server/`, not inside the actions, keeps that move cheap.
