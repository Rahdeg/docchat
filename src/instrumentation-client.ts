import { sentryOptions } from "@/lib/monitoring";

// Browser error monitoring, only when SENTRY_DSN was set at build (next.config.ts copies it to
// NEXT_PUBLIC_SENTRY_DSN). Loaded after the page, so pages without a DSN, and the public pages'
// first load, don't pay for Sentry's SDK. Reads process.env directly: it's inlined at build, and
// @/lib/env would bring Zod into every page.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(sentryOptions(dsn, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT));
  });
}
