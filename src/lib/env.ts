import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { TEST_DOUBLE_RULE, testDoublesAllowed } from "./test-doubles";

// "fake" providers and the "local" store are test doubles: CI and tests only (docs/adr/0009).
const notInProduction = (double: string) => (value: string) =>
  value !== double || testDoublesAllowed();

// A free-tier limit (src/lib/limits.ts): a positive whole number, or unset for the default.
const limitNumber = z.coerce.number().int().positive().optional();

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
    // Where uploaded files live. "blob" (default) is the private Vercel Blob store. "local" keeps
    // them on disk under LOCAL_STORAGE_DIR, for the end-to-end tests in CI only (a test double:
    // refused outside tests and CI). BLOB_READ_WRITE_TOKEN is still required; CI sets a dummy.
    STORAGE_DRIVER: z
      .enum(["blob", "local"])
      .default("blob")
      .refine(notInProduction("local"), `STORAGE_DRIVER=local: ${TEST_DOUBLE_RULE}`),
    // Folder for STORAGE_DRIVER=local. Default: .data/uploads in the working directory.
    LOCAL_STORAGE_DIR: z.string().min(1).optional(),
    // Who embeds chunks and queries (docs/adr/0005). "google" is the Gemini API on its paid tier
    // (paid-tier content isn't used to improve Google's products): development and production.
    // "gateway" (Vercel AI Gateway) is the optional alternative.
    // Changing it means re-embedding: run `pnpm db:backfill-embeddings`.
    // "fake" is a test double: hashed bag-of-words vectors, no network (src/server/ai/fake.ts).
    EMBEDDING_PROVIDER: z
      .enum(["google", "gateway", "fake"])
      .default("google")
      .refine(notInProduction("fake"), `EMBEDDING_PROVIDER=fake: ${TEST_DOUBLE_RULE}`),
    // Gemini API key (Google AI Studio), used when EMBEDDING_PROVIDER is "google".
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    // Vercel AI Gateway key, for embeddings when EMBEDDING_PROVIDER is "gateway" and chat when
    // CHAT_PROVIDER is "gateway". Optional because deployments on Vercel authenticate with the project's OIDC token
    // instead. Locally, set it: the pulled OIDC token expires after 12 hours. A key always wins
    // over OIDC, even an invalid one.
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
    // Who writes answers (docs/adr/0006). "google" is the Gemini API's paid tier, as for
    // embeddings; "gateway" is the optional alternative.
    // "fake" is a test double: answers by copying the best-matching sentence, with a valid
    // citation, and proposes tasks from must/should sentences (src/server/ai/fake.ts).
    CHAT_PROVIDER: z
      .enum(["google", "gateway", "fake"])
      .default("google")
      .refine(notInProduction("fake"), `CHAT_PROVIDER=fake: ${TEST_DOUBLE_RULE}`),
    // Optional: a different answer model on CHAT_PROVIDER, e.g. "gemini-3.8-flash" or
    // "anthropic/claude-opus-5.5". For trying a model, or when the default's quota is used up.
    CHAT_ANSWER_MODEL: z.string().trim().min(1).max(100).optional(),
    // Free-tier limits (src/lib/limits.ts, docs/adr/0010). Each is optional: unset uses the
    // default there. Read at build time too (the landing page shows two of them).
    MAX_DOCUMENTS_PER_USER: limitNumber,
    MAX_FILE_MB: limitNumber,
    MAX_PAGES_PER_DOCUMENT: limitNumber,
    QUESTIONS_PER_MINUTE: limitNumber,
    QUESTIONS_PER_DAY: limitNumber,
    AGENT_RUNS_PER_DAY: limitNumber,
    MAX_QUESTION_CHARS: limitNumber,
    MAX_OUTPUT_TOKENS: limitNumber,
    AGENT_MAX_OUTPUT_TOKENS: limitNumber,
    HISTORY_MESSAGES: limitNumber,
    GLOBAL_QUESTIONS_PER_DAY: limitNumber,
    MCP_SEARCHES_PER_DAY: limitNumber,
    REINDEX_PER_HOUR: limitNumber,
    // Clerk user ids (user_…), comma-separated, that skip the per-user limits.
    UNLIMITED_USER_IDS: z
      .string()
      .refine(
        (value) =>
          value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
            .every((id) => /^user_[A-Za-z0-9]+$/.test(id)),
        "Clerk user ids (user_…), comma-separated.",
      )
      .optional(),
    // Svix signing secret (whsec_…) of the Clerk webhook endpoint at /api/webhooks/clerk, which
    // deletes a user's data when Clerk sends user.deleted (docs/adr/0008).
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),
    // The app's public origin without a path: "https://docchat.raheem.online" in production.
    // Metadata (metadataBase, so the Open Graph image), the sitemap, robots.txt and the MCP
    // server's URL (<APP_URL>/mcp) come from it. OAuth tokens must be issued for exactly that
    // URL (their audience), so it must match the URL registered in Clerk. Read at build time
    // too (the public pages are static), so changing it needs a redeploy. Unset: Vercel's
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
    // Sentry error monitoring (src/lib/monitoring.ts). Unset: monitoring is off everywhere. Read
    // at build too: next.config.ts copies it to the browser as NEXT_PUBLIC_SENTRY_DSN.
    SENTRY_DSN: z.url().optional(),
    // Build only: uploading source maps to Sentry. All three, or no upload.
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    SENTRY_ORG: z.string().min(1).optional(),
    SENTRY_PROJECT: z.string().min(1).optional(),
    // Set by Vercel: production, preview or development. Sentry's environment.
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
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
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    CHAT_PROVIDER: process.env.CHAT_PROVIDER,
    CHAT_ANSWER_MODEL: process.env.CHAT_ANSWER_MODEL,
    MAX_DOCUMENTS_PER_USER: process.env.MAX_DOCUMENTS_PER_USER,
    MAX_FILE_MB: process.env.MAX_FILE_MB,
    MAX_PAGES_PER_DOCUMENT: process.env.MAX_PAGES_PER_DOCUMENT,
    QUESTIONS_PER_MINUTE: process.env.QUESTIONS_PER_MINUTE,
    QUESTIONS_PER_DAY: process.env.QUESTIONS_PER_DAY,
    AGENT_RUNS_PER_DAY: process.env.AGENT_RUNS_PER_DAY,
    MAX_QUESTION_CHARS: process.env.MAX_QUESTION_CHARS,
    MAX_OUTPUT_TOKENS: process.env.MAX_OUTPUT_TOKENS,
    AGENT_MAX_OUTPUT_TOKENS: process.env.AGENT_MAX_OUTPUT_TOKENS,
    HISTORY_MESSAGES: process.env.HISTORY_MESSAGES,
    GLOBAL_QUESTIONS_PER_DAY: process.env.GLOBAL_QUESTIONS_PER_DAY,
    MCP_SEARCHES_PER_DAY: process.env.MCP_SEARCHES_PER_DAY,
    REINDEX_PER_HOUR: process.env.REINDEX_PER_HOUR,
    UNLIMITED_USER_IDS: process.env.UNLIMITED_USER_IDS,
    CLERK_WEBHOOK_SIGNING_SECRET: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    APP_URL: process.env.APP_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    MCP_ENABLED: process.env.MCP_ENABLED,
    CSP_REPORT_ONLY: process.env.CSP_REPORT_ONLY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  // CI builds and tests run without a database. Never set this in a deployed environment.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
