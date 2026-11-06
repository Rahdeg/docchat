import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Variables become required in the PR that wires up their service.
// Each TODO marks where to drop `.optional()` in that PR.
export const env = createEnv({
  server: {
    // Pooled Neon connection string, used by the app.
    DATABASE_URL: z.url(),
    // Direct (unpooled) connection string. Only drizzle-kit needs it, so it stays optional.
    DATABASE_URL_UNPOOLED: z.url().optional(),
    // Clerk Backend API key (sk_test_… / sk_live_…). Server only.
    CLERK_SECRET_KEY: z.string().startsWith("sk_"),
    // Private Vercel Blob store for uploaded files. handleUpload() needs this static token to sign
    // browser uploads (OIDC isn't enough), and src/server/blob.ts passes it on every call.
    BLOB_READ_WRITE_TOKEN: z.string().startsWith("vercel_blob_rw_"),
    // Who embeds chunks and queries (docs/adr/0005). "google" is the Gemini API's free tier: for
    // development with fictional documents only. Production switches to "gateway" before launch.
    // Changing it means re-embedding: run `pnpm db:backfill-embeddings`.
    EMBEDDING_PROVIDER: z.enum(["google", "gateway"]).default("google"),
    // Gemini API key (Google AI Studio), used when EMBEDDING_PROVIDER is "google".
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    // Vercel AI Gateway key, for embeddings when EMBEDDING_PROVIDER is "gateway" and chat when
    // CHAT_PROVIDER is "gateway". Optional because deployments on Vercel authenticate with the project's OIDC token
    // instead. Locally, set it: the pulled OIDC token expires after 12 hours. A key always wins
    // over OIDC, even an invalid one.
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
    // Who writes answers (docs/adr/0006). "google" is the Gemini API's free tier, under the same
    // rule as embeddings: fictional documents only. Production switches to "gateway".
    CHAT_PROVIDER: z.enum(["google", "gateway"]).default("google"),
    // Optional: a different answer model on CHAT_PROVIDER, e.g. "gemini-3.8-flash" or
    // "anthropic/claude-opus-5.5". For trying a model, or when the default's quota is used up.
    CHAT_ANSWER_MODEL: z.string().trim().min(1).max(100).optional(),
    // Answers one user may generate per UTC day. The free tier's daily quota is shared by
    // every user, so one person can't use it all up. Unset: 10 on "google", 50 on "gateway"
    // (src/server/ai/limits.ts).
    CHAT_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
    // Svix signing secret (whsec_…) of the Clerk webhook endpoint at /api/webhooks/clerk, which
    // deletes a user's data when Clerk sends user.deleted (docs/adr/0008).
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),
    // The app's public origin, e.g. "https://docchat.example.com", without a path. The MCP
    // server's URL is <APP_URL>/mcp, and OAuth tokens must be issued for exactly that URL
    // (their audience), so it must match the URL registered in Clerk. Unset: Vercel's
    // production domain, then http://localhost:3000 (src/lib/app-url.ts).
    APP_URL: z
      .url()
      .refine(
        (value) => new URL(value).origin === value.replace(/\/$/, ""),
        "Origin only, no path.",
      )
      .optional(),
    // Set by Vercel: the project's production domain, without a scheme.
    VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1).optional(),
    // Turns the MCP server off: /mcp answers 503 and Settings says it's off. Default on.
    MCP_ENABLED: z.stringbool().default(true),
    // Sends the Content-Security-Policy as Content-Security-Policy-Report-Only instead, so a
    // policy that breaks a page can be relaxed without blocking anything. Read at build time
    // (next.config.ts), so changing it needs a redeploy. Default off: the policy is enforced.
    CSP_REPORT_ONLY: z.stringbool().default(false),
  },
  client: {
    // Clerk Frontend API key (pk_test_… / pk_live_…).
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    CHAT_PROVIDER: process.env.CHAT_PROVIDER,
    CHAT_ANSWER_MODEL: process.env.CHAT_ANSWER_MODEL,
    CHAT_DAILY_LIMIT: process.env.CHAT_DAILY_LIMIT,
    CLERK_WEBHOOK_SIGNING_SECRET: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    APP_URL: process.env.APP_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    MCP_ENABLED: process.env.MCP_ENABLED,
    CSP_REPORT_ONLY: process.env.CSP_REPORT_ONLY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  // CI builds and tests run without a database. Never set this in a deployed environment.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
