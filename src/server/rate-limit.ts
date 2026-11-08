import "server-only";

import { and, count, eq, gte, lt, sql } from "drizzle-orm";

import {
  LONGEST_WINDOW_SECONDS,
  RATE_LIMITS,
  rateLimitMessage,
  type RateLimit,
  type RateLimitBucket,
} from "@/lib/rate-limits";
import { db } from "@/server/db";
import { rateLimitEvent } from "@/server/db/schema";
import { log } from "@/server/log";

// Sliding-window rate limits in Postgres (docs/adr/0008). No Redis: the counts live in
// rate_limit_event, one row per counted request.

export type RateLimitCheck =
  { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number; message: string };

const secondsAgo = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Events in the user's current window for this bucket, and when the oldest one leaves it.
async function windowState(tx: Tx | typeof db, userId: string, bucket: RateLimitBucket) {
  const { windowSeconds, max } = RATE_LIMITS[bucket];
  const [row] = await tx
    .select({
      used: count(),
      retryAfter: sql<
        string | null
      >`extract(epoch from (min(${rateLimitEvent.createdAt}) + make_interval(secs => ${windowSeconds}) - now()))`,
    })
    .from(rateLimitEvent)
    .where(
      and(
        eq(rateLimitEvent.userId, userId),
        eq(rateLimitEvent.bucket, bucket),
        gte(rateLimitEvent.createdAt, secondsAgo(windowSeconds)),
      ),
    );
  const used = row?.used ?? 0;
  // Full: the window frees up when its oldest event leaves it.
  const retryAfterSeconds = used < max ? 0 : Math.max(1, Number(row?.retryAfter ?? windowSeconds));
  return { used, retryAfterSeconds };
}

function result(
  bucket: RateLimitBucket,
  limit: RateLimit,
  used: number,
  retryAfterSeconds: number,
): RateLimitCheck {
  if (used < limit.max) return { ok: true, remaining: limit.max - used };
  return { ok: false, retryAfterSeconds, message: rateLimitMessage(bucket, retryAfterSeconds) };
}

// Counts one request against the user's limit, or refuses it. A per-user, per-bucket advisory
// lock (released at commit) makes concurrent requests count one after another, so a burst
// can't all get in under the limit. Also clears the user's events that no window counts any
// more.
export async function consumeRateLimit(
  userId: string,
  bucket: RateLimitBucket,
): Promise<RateLimitCheck> {
  const limit = RATE_LIMITS[bucket];
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${bucket}`}, 0))`,
    );
    await tx
      .delete(rateLimitEvent)
      .where(
        and(
          eq(rateLimitEvent.userId, userId),
          lt(rateLimitEvent.createdAt, secondsAgo(LONGEST_WINDOW_SECONDS)),
        ),
      );
    const { used, retryAfterSeconds } = await windowState(tx, userId, bucket);
    if (used >= limit.max) {
      log("quota.hit", { userId, limit: bucket }, "warn");
      return result(bucket, limit, used, retryAfterSeconds);
    }
    await tx.insert(rateLimitEvent).values({ userId, bucket });
    return { ok: true, remaining: limit.max - used - 1 };
  });
}

// Whether the next request would be refused, without counting one. For explaining a failure
// after the fact (an upload whose token was refused).
export async function peekRateLimit(
  userId: string,
  bucket: RateLimitBucket,
): Promise<RateLimitCheck> {
  const limit = RATE_LIMITS[bucket];
  const { used, retryAfterSeconds } = await windowState(db, userId, bucket);
  return result(bucket, limit, used, retryAfterSeconds);
}
