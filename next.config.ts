import type { NextConfig } from "next";

// Validate env at build time.
import { env } from "./src/lib/env";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
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

export default nextConfig;
