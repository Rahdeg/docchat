import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/monitoring";

// Runs once when a server starts (Next.js instrumentation).
export async function register() {
  const { env } = await import("@/lib/env");

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validates the env now rather than on the first request, and refuses to start with a test
    // double (fake AI providers, local file storage) outside tests and CI, even if validation
    // was skipped (docs/adr/0009).
    const { assertTestDoublesAllowed } = await import("@/lib/test-doubles");
    assertTestDoublesAllowed(env);
  }

  // Error monitoring only when SENTRY_DSN is set (src/lib/monitoring.ts).
  if (env.SENTRY_DSN) {
    Sentry.init(sentryOptions(env.SENTRY_DSN, env.VERCEL_ENV ?? process.env.NODE_ENV));
  }
}

// Errors thrown while rendering, in route handlers, Server Actions and the proxy. A no-op
// without SENTRY_DSN.
export const onRequestError = Sentry.captureRequestError;
