import "server-only";

import { date, index, integer, pgTable, primaryKey, timestamp } from "drizzle-orm/pg-core";

import { id, userId } from "./columns";
import { rateLimitBucket, usageCounterKind } from "./enums";

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

// The user_id of the counters shared by everyone (the global breaker). Clerk ids start with
// "user_", so it can't collide with one.
export const GLOBAL_COUNTER_USER = "*";

// Fixed daily windows (UTC days), one row per user, kind and day, counted up with an atomic
// upsert (src/server/rate-limit.ts). Old days are deleted as the user's new ones are written.
export const usageCounter = pgTable(
  "usage_counter",
  {
    // A Clerk user id, or GLOBAL_COUNTER_USER.
    userId: userId(),
    kind: usageCounterKind("kind").notNull(),
    // The UTC day counted.
    day: date("day", { mode: "string" }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.day] }),
    index("usage_counter_user_id_idx").on(t.userId),
  ],
);

export type UsageCounter = typeof usageCounter.$inferSelect;
