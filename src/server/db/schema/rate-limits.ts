import "server-only";

import { index, pgTable, timestamp } from "drizzle-orm/pg-core";

import { id, userId } from "./columns";
import { rateLimitBucket } from "./enums";

// One row per counted request (an MCP tool call, a search, an upload), for sliding-window rate
// limits (src/server/rate-limit.ts). Rows older than the longest window are deleted as new
// ones are written, so the table only holds the last hour or so per user.
export const rateLimitEvent = pgTable(
  "rate_limit_event",
  {
    id: id(),
    userId: userId(),
    bucket: rateLimitBucket("bucket").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rate_limit_event_user_id_idx").on(t.userId),
    // The check: one user's events in one bucket since the window started.
    index("rate_limit_event_user_id_bucket_created_at_idx").on(t.userId, t.bucket, t.createdAt),
  ],
);

export type RateLimitEvent = typeof rateLimitEvent.$inferSelect;
