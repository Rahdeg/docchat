import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Every variable is optional until the PR that wires up its service.
// Each TODO marks where to drop `.optional()` in that PR.
export const env = createEnv({
  server: {
    // TODO(db): make required when Neon + Drizzle land.
    DATABASE_URL: z.url().optional(),
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
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    AI_API_KEY: process.env.AI_API_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
});
