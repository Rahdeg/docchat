import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Step } from "./rate-limit";

// The limiter against Postgres. Imported lazily: CI has no database. Tests use their own
// subjects for "global" counters, never the real one ("*").
const userId = `test_rate_limit_${process.pid}`;
const globalSubject = `test_global_${process.pid}`;

describe.skipIf(!process.env.DATABASE_URL)("rate limits", { timeout: 60_000 }, () => {
  async function load() {
    const limiter = await import("./rate-limit");
    const { db } = await import("./db");
    const { rateLimitEvent, usageCounter } = await import("./db/schema");
    const { and, eq, inArray, sql } = await import("drizzle-orm");
    return { ...limiter, db, rateLimitEvent, usageCounter, and, eq, inArray, sql };
  }

  async function clear() {
    const { db, rateLimitEvent, usageCounter, eq, inArray } = await load();
    await db.delete(rateLimitEvent).where(eq(rateLimitEvent.userId, userId));
    await db.delete(usageCounter).where(inArray(usageCounter.userId, [userId, globalSubject]));
  }

  beforeEach(clear);
  afterAll(clear);

  const daily = (subject: string, max: number): Step => ({
    type: "daily",
    subject,
    kind: "question",
    max,
    failure:
      subject === globalSubject ? { code: "GLOBAL_PAUSED" } : { code: "QUESTIONS_PER_DAY", max },
  });

  async function count(subject: string) {
    const { db, usageCounter, and, eq } = await load();
    const rows = await db
      .select({ count: usageCounter.count, day: usageCounter.day })
      .from(usageCounter)
      .where(and(eq(usageCounter.userId, subject), eq(usageCounter.kind, "question")));
    return rows;
  }

  describe("sliding windows", () => {
    it("allows up to the limit, then refuses with a wait time", async () => {
      const { consumeRateLimit, peekRateLimit } = await load();
      // upload: 20 an hour.
      const results = [];
      for (let i = 0; i < 20; i += 1) results.push(await consumeRateLimit(userId, "upload"));
      expect(results.every((r) => r.ok)).toBe(true);

      const refused = await consumeRateLimit(userId, "upload");
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.failure).toMatchObject({ code: "RATE_LIMITED", bucket: "upload", max: 20 });
      if (refused.failure.code !== "RATE_LIMITED") return;
      expect(refused.failure.retryAfterSeconds).toBeGreaterThan(3500);

      // A refusal isn't counted, and peeking doesn't count either.
      expect((await peekRateLimit(userId, "upload")).ok).toBe(false);
      // Other buckets are separate.
      expect((await consumeRateLimit(userId, "search")).ok).toBe(true);
    });

    it("counts only the last 60 seconds, and says when the oldest one leaves", async () => {
      const { consumeSteps, db, rateLimitEvent, sql } = await load();
      const question: Step[] = [{ type: "window", bucket: "question" }];
      // Five questions 61 seconds ago are outside the window.
      await db.insert(rateLimitEvent).values(
        Array.from({ length: 5 }, () => ({
          userId,
          bucket: "question" as const,
          createdAt: sql`now() - interval '61 seconds'`,
        })),
      );
      expect((await consumeSteps(userId, question)).ok).toBe(true);

      // Four more at 20 seconds ago: five inside the window now, so the sixth waits ~40 s.
      await db.insert(rateLimitEvent).values(
        Array.from({ length: 4 }, () => ({
          userId,
          bucket: "question" as const,
          createdAt: sql`now() - interval '20 seconds'`,
        })),
      );
      const refused = await consumeSteps(userId, question);
      expect(refused.ok).toBe(false);
      if (refused.ok || refused.failure.code !== "QUESTIONS_PER_MINUTE") return;
      // The oldest in the window is 20 s old, so it leaves in about 40 s.
      expect(refused.failure.retryAfterSeconds).toBeGreaterThan(35);
      expect(refused.failure.retryAfterSeconds).toBeLessThanOrEqual(41);
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

  describe("daily counters", () => {
    it("counts up to the limit, then refuses", async () => {
      const { consumeSteps } = await load();
      const steps = [daily(userId, 3)];

      const results = [];
      for (let i = 0; i < 4; i += 1) results.push(await consumeSteps(userId, steps));

      expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
      expect(results[2]).toEqual({ ok: true, counts: { question: 3 } });
      expect(results[3]).toEqual({
        ok: false,
        failure: { code: "QUESTIONS_PER_DAY", max: 3 },
      });
    });

    it("starts again on a new UTC day, and deletes the old days", async () => {
      const { consumeSteps, db, usageCounter, sql } = await load();
      await db.insert(usageCounter).values({
        userId,
        kind: "question",
        day: sql`(now() at time zone 'UTC')::date - 1`,
        count: 3,
      });

      expect((await consumeSteps(userId, [daily(userId, 3)])).ok).toBe(true);
      const rows = await count(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.count).toBe(1);
    });

    it("counts concurrent requests one at a time", async () => {
      const { consumeSteps } = await load();
      const results = await Promise.all(
        Array.from({ length: 12 }, () => consumeSteps(userId, [daily(userId, 5)])),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect((await count(userId))[0]?.count).toBe(5);
    });

    it("counts nothing when a later check refuses (the global breaker)", async () => {
      const { consumeSteps, db, usageCounter, sql } = await load();
      await db.insert(usageCounter).values({
        userId: globalSubject,
        kind: "question",
        day: sql`(now() at time zone 'UTC')::date`,
        count: 2,
      });
      const steps: Step[] = [
        { type: "window", bucket: "question" },
        daily(userId, 30),
        daily(globalSubject, 2),
      ];

      const result = await consumeSteps(userId, steps);

      expect(result).toEqual({ ok: false, failure: { code: "GLOBAL_PAUSED" } });
      // The user's minute and day weren't used up by a refused question.
      expect(await count(userId)).toEqual([]);
      const { rateLimitEvent, eq } = await load();
      expect(await db.$count(rateLimitEvent, eq(rateLimitEvent.userId, userId))).toBe(0);
    });

    it("checks without counting for an open step", async () => {
      const { consumeSteps } = await load();
      const open: Step = { ...daily(globalSubject, 1), type: "open" } as Step;

      expect((await consumeSteps(userId, [open])).ok).toBe(true);
      expect(await count(globalSubject)).toEqual([]);
      await consumeSteps(userId, [daily(globalSubject, 1)]);
      expect(await consumeSteps(userId, [open])).toEqual({
        ok: false,
        failure: { code: "GLOBAL_PAUSED" },
      });
    });
  });
});
