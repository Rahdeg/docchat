import "server-only";

import { and, count, eq, gte, lt, sql } from "drizzle-orm";

import type { LimitFailure } from "@/lib/limit-messages";
import { isUnlimited, LIMITS, type Limits } from "@/lib/limits";
import { db } from "@/server/db";
import {
  GLOBAL_COUNTER_USER,
  rateLimitEvent,
  usageCounter,
  type RateLimitBucket,
  type UsageCounterKind,
} from "@/server/db/schema";
import { log } from "@/server/log";

// Limits counted in Postgres (docs/adr/0008, docs/adr/0010), so every serverless instance sees
// the same counts. No Redis, no paid service. Two kinds:
// - Sliding windows (rate_limit_event, one row per counted request) for "per minute" and "per
//   hour": the refusal says exactly when the oldest request leaves the window.
// - Daily counters (usage_counter, one row per user, kind and UTC day) for "per day" and the
//   global breaker: an atomic upsert that only counts up while under the limit.
// A request's checks run in one transaction: if any refuses, none of them is counted.

export type RateLimitCheck = { ok: true } | { ok: false; failure: LimitFailure };

export type Step =
  | { type: "window"; bucket: RateLimitBucket }
  | { type: "daily"; subject: string; kind: UsageCounterKind; max: number; failure: LimitFailure }
  // Refuses once the counter is full, without counting (MCP search and the global breaker).
  | { type: "open"; subject: string; kind: UsageCounterKind; max: number; failure: LimitFailure };

export function windowFor(bucket: RateLimitBucket, limits: Limits = LIMITS) {
  switch (bucket) {
    case "mcp":
      return { max: limits.mcpCallsPerMinute, windowSeconds: 60 };
    case "search":
      return { max: limits.searchesPerMinute, windowSeconds: 60 };
    case "upload":
      return { max: limits.uploadsPerHour, windowSeconds: 60 * 60 };
    case "question":
      return { max: limits.questionsPerMinute, windowSeconds: 60 };
    case "reindex":
      return { max: limits.reindexPerHour, windowSeconds: 60 * 60 };
  }
}

// Events older than this are never counted again, so they can be deleted.
export const LONGEST_WINDOW_SECONDS = 60 * 60;

export function windowFailure(
  bucket: RateLimitBucket,
  retryAfterSeconds: number,
  limits: Limits = LIMITS,
): LimitFailure {
  const { max } = windowFor(bucket, limits);
  return bucket === "question"
    ? { code: "QUESTIONS_PER_MINUTE", max, retryAfterSeconds }
    : { code: "RATE_LIMITED", bucket, max, retryAfterSeconds };
}

type DailyStep = Extract<Step, { type: "daily" }>;

const globalQuestions = (limits: Limits): DailyStep => ({
  type: "daily",
  subject: GLOBAL_COUNTER_USER,
  kind: "question",
  max: limits.globalQuestionsPerDay,
  failure: { code: "GLOBAL_PAUSED" },
});

// A question on /chat (a new one or "Try again"): the user's minute and day, a task request's
// daily allowance, then the global breaker last, so a question the user's own limits refuse
// never uses up everyone's. Unlimited users only meet the global breaker.
export function questionSteps(
  userId: string,
  { agent }: { agent: boolean },
  limits: Limits = LIMITS,
): Step[] {
  const own: Step[] = isUnlimited(userId, limits)
    ? []
    : [
        { type: "window", bucket: "question" },
        {
          type: "daily",
          subject: userId,
          kind: "question",
          max: limits.questionsPerDay,
          failure: { code: "QUESTIONS_PER_DAY", max: limits.questionsPerDay },
        },
        ...(agent
          ? [
              {
                type: "daily",
                subject: userId,
                kind: "agent-run",
                max: limits.agentRunsPerDay,
                failure: { code: "AGENT_RUNS_PER_DAY", max: limits.agentRunsPerDay },
              } satisfies Step,
            ]
          : []),
      ];
  return [...own, globalQuestions(limits)];
}

// An MCP tool call. A search also embeds a query: the minute's searches, the day's MCP
// searches, and it stops while the global breaker is tripped (it doesn't count towards it:
// it costs an embedding, not a chat call).
export function mcpSteps(
  userId: string,
  { search }: { search: boolean },
  limits: Limits = LIMITS,
): Step[] {
  const unlimited = isUnlimited(userId, limits);
  if (!search) return unlimited ? [] : [{ type: "window", bucket: "mcp" }];
  const breaker = globalQuestions(limits);
  return [
    ...(unlimited
      ? []
      : ([
          { type: "window", bucket: "mcp" },
          { type: "window", bucket: "search" },
          {
            type: "daily",
            subject: userId,
            kind: "mcp-search",
            max: limits.mcpSearchesPerDay,
            failure: { code: "MCP_SEARCHES_PER_DAY", max: limits.mcpSearchesPerDay },
          },
        ] satisfies Step[])),
    { ...breaker, type: "open" },
  ];
}

class Refused extends Error {
  constructor(readonly failure: LimitFailure) {
    super(failure.code);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const secondsAgo = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;
const utcToday = sql`(now() at time zone 'UTC')::date`;

// Events in the user's current window for this bucket, and when the oldest one leaves it.
async function windowState(tx: Tx | typeof db, userId: string, bucket: RateLimitBucket) {
  const { windowSeconds, max } = windowFor(bucket);
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
  return { used, max, retryAfterSeconds };
}

// A per-user, per-bucket advisory lock (released at commit) makes concurrent requests count one
// after another, so a burst can't all get in under the limit. Also clears the user's events
// that no window counts any more.
async function consumeWindow(tx: Tx, userId: string, bucket: RateLimitBucket) {
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
  const { used, max, retryAfterSeconds } = await windowState(tx, userId, bucket);
  if (used >= max) throw new Refused(windowFailure(bucket, retryAfterSeconds));
  await tx.insert(rateLimitEvent).values({ userId, bucket });
}

// Counts one up, unless the counter is already at `max`. The upsert takes the row's lock, so
// concurrent requests count one after another. Returns the new count.
async function consumeDaily(tx: Tx, step: DailyStep): Promise<number> {
  await tx
    .delete(usageCounter)
    .where(and(eq(usageCounter.userId, step.subject), lt(usageCounter.day, utcToday)));
  const [row] = await tx
    .insert(usageCounter)
    .values({ userId: step.subject, kind: step.kind, day: utcToday, count: 1 })
    .onConflictDoUpdate({
      target: [usageCounter.userId, usageCounter.kind, usageCounter.day],
      set: { count: sql`${usageCounter.count} + 1` },
      setWhere: sql`${usageCounter.count} < ${step.max}`,
    })
    .returning({ count: usageCounter.count });
  if (!row) throw new Refused(step.failure);
  return row.count;
}

async function dailyCount(tx: Tx | typeof db, subject: string, kind: UsageCounterKind) {
  const [row] = await tx
    .select({ count: usageCounter.count })
    .from(usageCounter)
    .where(
      and(
        eq(usageCounter.userId, subject),
        eq(usageCounter.kind, kind),
        eq(usageCounter.day, utcToday),
      ),
    );
  return row?.count ?? 0;
}

export type StepsResult =
  | { ok: true; counts: Partial<Record<UsageCounterKind, number>> }
  | { ok: false; failure: LimitFailure };

// Runs the steps in order in one transaction. The first refusal rolls back everything counted
// before it. `counts` has the user's own daily counts after this request.
export async function consumeSteps(userId: string, steps: Step[]): Promise<StepsResult> {
  if (steps.length === 0) return { ok: true, counts: {} };
  try {
    const counts = await db.transaction(async (tx) => {
      const counted: Partial<Record<UsageCounterKind, number>> = {};
      for (const step of steps) {
        if (step.type === "window") {
          await consumeWindow(tx, userId, step.bucket);
        } else if (step.type === "daily") {
          const used = await consumeDaily(tx, step);
          if (step.subject === userId) counted[step.kind] = used;
        } else if ((await dailyCount(tx, step.subject, step.kind)) >= step.max) {
          throw new Refused(step.failure);
        }
      }
      return counted;
    });
    return { ok: true, counts };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    log("quota.hit", { userId, limit: error.failure.code }, "warn");
    return { ok: false, failure: error.failure };
  }
}

// One question on /chat. `questionsLeft` is what remains of the user's day (null: unlimited).
export async function consumeQuestion(
  userId: string,
  options: { agent: boolean },
): Promise<{ ok: true; questionsLeft: number | null } | { ok: false; failure: LimitFailure }> {
  const result = await consumeSteps(userId, questionSteps(userId, options));
  if (!result.ok) return result;
  return {
    ok: true,
    questionsLeft: isUnlimited(userId)
      ? null
      : Math.max(0, LIMITS.questionsPerDay - (result.counts.question ?? 0)),
  };
}

// One MCP tool call.
export async function consumeMcpCall(
  userId: string,
  options: { search: boolean },
): Promise<RateLimitCheck> {
  const result = await consumeSteps(userId, mcpSteps(userId, options));
  return result.ok ? { ok: true } : result;
}

// One request in a sliding-window bucket (upload tokens, re-reading a document). Unlimited users
// aren't counted.
export async function consumeRateLimit(
  userId: string,
  bucket: RateLimitBucket,
): Promise<RateLimitCheck> {
  if (isUnlimited(userId)) return { ok: true };
  const result = await consumeSteps(userId, [{ type: "window", bucket }]);
  return result.ok ? { ok: true } : result;
}

// Whether the next request would be refused, without counting one. For explaining a failure
// after the fact (an upload whose token was refused).
export async function peekRateLimit(
  userId: string,
  bucket: RateLimitBucket,
): Promise<RateLimitCheck> {
  if (isUnlimited(userId)) return { ok: true };
  const { used, max, retryAfterSeconds } = await windowState(db, userId, bucket);
  return used < max
    ? { ok: true }
    : { ok: false, failure: windowFailure(bucket, retryAfterSeconds) };
}

// What's left of the user's questions today, for the composer. Null: unlimited.
export async function questionsLeftToday(userId: string): Promise<number | null> {
  if (isUnlimited(userId)) return null;
  return Math.max(0, LIMITS.questionsPerDay - (await dailyCount(db, userId, "question")));
}
