import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Imported lazily: CI has no database.
const userId = `test_rate_limit_${process.pid}`;

describe.skipIf(!process.env.DATABASE_URL)("rate limits", { timeout: 60_000 }, () => {
  async function load() {
    const { consumeRateLimit, peekRateLimit } = await import("./rate-limit");
    const { db } = await import("./db");
    const { rateLimitEvent } = await import("./db/schema");
    const { eq, sql } = await import("drizzle-orm");
    return { consumeRateLimit, peekRateLimit, db, rateLimitEvent, eq, sql };
  }

  beforeEach(async () => {
    const { db, rateLimitEvent, eq } = await load();
    await db.delete(rateLimitEvent).where(eq(rateLimitEvent.userId, userId));
  });

  afterAll(async () => {
    const { db, rateLimitEvent, eq } = await load();
    await db.delete(rateLimitEvent).where(eq(rateLimitEvent.userId, userId));
  });

  it("allows up to the limit, then refuses with a wait time", async () => {
    const { consumeRateLimit, peekRateLimit } = await load();
    // upload: 20 an hour.
    const results = [];
    for (let i = 0; i < 20; i += 1) results.push(await consumeRateLimit(userId, "upload"));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.at(-1)).toEqual({ ok: true, remaining: 0 });

    const refused = await consumeRateLimit(userId, "upload");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.retryAfterSeconds).toBeGreaterThan(3500);
    expect(refused.message).toMatch(/You've uploaded 20 files in the last hour/);

    // A refusal isn't counted, and peeking doesn't count either.
    expect((await peekRateLimit(userId, "upload")).ok).toBe(false);
    // Other buckets are separate.
    expect((await consumeRateLimit(userId, "search")).ok).toBe(true);
  });

  it("counts a concurrent burst one at a time", async () => {
    const { consumeRateLimit } = await load();
    // search: 30 a minute. 40 at once: exactly 30 get in.
    const results = await Promise.all(
      Array.from({ length: 40 }, () => consumeRateLimit(userId, "search")),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(30);
  });

  it("forgets events once the window has passed, and deletes stale ones", async () => {
    const { consumeRateLimit, db, rateLimitEvent, eq, sql } = await load();
    // 30 searches two minutes ago, plus one from two hours ago.
    await db.insert(rateLimitEvent).values([
      ...Array.from({ length: 30 }, () => ({
        userId,
        bucket: "search" as const,
        createdAt: sql`now() - interval '2 minutes'`,
      })),
      { userId, bucket: "upload" as const, createdAt: sql`now() - interval '2 hours'` },
    ]);

    expect((await consumeRateLimit(userId, "search")).ok).toBe(true);
    const left = await db.$count(rateLimitEvent, eq(rateLimitEvent.userId, userId));
    // The two-hour-old event is gone; the recent ones stay until they're an hour old.
    expect(left).toBe(31);
  });
});
