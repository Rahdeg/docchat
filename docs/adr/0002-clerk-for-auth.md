# ADR 0002: Clerk for authentication

- Status: Accepted
- Date: 2026-10-21

## Context

DocChat needs sign-up, sign-in, sessions and basic user management before any document or chat
feature is useful. Building and securing this ourselves (password storage, OAuth, email
verification, session rotation, account recovery) is slow and risky, and none of it sets the product
apart.

## Decision

Use Clerk via `@clerk/nextjs`:

- Clerk's hosted or embedded sign-in and sign-up UI under `src/app/(auth)`.
- Route protection in `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`).
- `auth()` in every Server Action and route handler; reject when `userId` is missing.

## Why Clerk

- Ready-made sign-in UI, social providers and MFA, so we don't build them.
- Sessions handled for us: issuing, refreshing and revoking.
- A user management dashboard (ban, impersonate, delete) for support.
- First-class App Router support (`auth()`, `clerkMiddleware`) and installed agent skills, so it's
  fast to ship correctly.

## Trade-offs

- **Vendor dependency:** pricing, outages and API changes are outside our control. Login fails
  if Clerk is down.
- **User data lives outside our database:** profile fields (name, email, avatar) are in Clerk,
  so we can't join on them in SQL, and we depend on Clerk for exports and deletion.
- **Migration cost:** moving providers later means migrating users and sessions.

## How we limit them

- We store only Clerk's `userId` (as `text`) on our own rows, with no local `users` table. Our data
  model doesn't depend on Clerk's user schema, and a migration means remapping one column.
- Clerk-specific code stays in `src/proxy.ts`, `src/app/(auth)` and a small auth helper. Feature
  code only sees a `userId` string.
- We fetch display data (name, avatar) from Clerk at render time. We only add a synced profile table
  (via webhooks) if a feature needs SQL joins on it, and that would be a new ADR.

## Amendment (2026-10-23)

`@clerk/nextjs` 7 deprecates `createRouteMatcher()` and Clerk no longer recommends protecting
routes in middleware. `src/proxy.ts` still runs `clerkMiddleware()`, but it only does optimistic
redirects. Pages and streamed components call `requireUserId()` (`src/server/auth.ts`), and Server
Actions go through `authedAction()` (`src/lib/action.ts`), which calls `auth()` before anything
else. The choice of Clerk is unchanged.
