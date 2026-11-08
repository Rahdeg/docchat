import "server-only";

import * as Sentry from "@sentry/nextjs";

// Server-side helpers for Sentry (src/lib/monitoring.ts). Both are no-ops when SENTRY_DSN isn't
// set: Sentry was never initialised (src/instrumentation.ts).

// Tags this request's errors with the Clerk user id, and nothing else about the user.
export function identifyUser(userId: string): void {
  Sentry.setUser({ id: userId });
}

// Reports an error that's handled (and so wouldn't reach Sentry): a failed indexing run, an
// answer that broke mid-stream. `where` is a fixed label, never data.
export function reportError(error: unknown, where: string): void {
  Sentry.captureException(error, { tags: { where } });
}
