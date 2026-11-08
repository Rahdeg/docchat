import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// Validate env at build time.
import { env } from "./src/lib/env";
import { securityHeaders } from "./src/lib/security-headers";

// Sentry (src/lib/monitoring.ts): monitoring is on only with SENTRY_DSN, and source maps upload
// only with SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT (set them in Vercel for builds).
const uploadSourceMaps = !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (Dockerfile). Vercel builds don't set it.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  cacheComponents: true,
  // The browser's copy of the DSN and environment, inlined at build. Empty: monitoring is off.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: env.SENTRY_DSN ?? "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: env.VERCEL_ENV ?? process.env.NODE_ENV ?? "",
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // CSP and the other security headers on every response (docs/adr/0008). Built when the
  // config loads, so CSP_REPORT_ONLY needs a redeploy to change.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          // The fallback covers CI, which skips env validation.
          publishableKey:
            env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
            `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`,
          development: process.env.NODE_ENV === "development",
          reportOnly: env.CSP_REPORT_ONLY ?? false,
        }),
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: env.SENTRY_ORG,
  project: env.SENTRY_PROJECT,
  authToken: env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !uploadSourceMaps },
  widenClientFileUpload: true,
  // Reports go through our own origin (src/app/sentry-tunnel/route.ts), a fixed path so the
  // proxy can let it through (isPublicPath).
  tunnelRoute: "/monitoring",
  // Errors only: no tracing, so no navigation hook needed.
  suppressOnRouterTransitionStartWarning: true,
  telemetry: false,
  silent: !process.env.CI,
});
