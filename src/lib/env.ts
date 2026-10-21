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
    // TODO(auth): make required when Clerk lands.
    CLERK_SECRET_KEY: z.string().min(1).optional(),
    // TODO(ai): make required when the AI SDK lands.
    AI_API_KEY: z.string().min(1).optional(),
  },
  client: {
    // TODO(auth): make required when Clerk lands.
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    AI_API_KEY: process.env.AI_API_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  // CI builds and tests run without a database. Never set this in a deployed environment.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
