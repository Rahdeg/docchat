import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { aiUsage } from "@/server/db/schema";

// Model calls per user per UTC day: CHAT_DAILY_LIMIT, or by provider. Both real providers are
// paid, so the limit caps what one user can spend. On Gemini's paid tier a typical answer costs
// about $0.003 (2,200 tokens in, 450 out, thinking included; $0.007 at the 2027 prices) and a
// long one about $0.04, so 25 calls cost one user at most about $1 a day (docs/adr/0006,
// amendment). The fake provider (CI's end-to-end tests) costs nothing.
const DEFAULT_DAILY_LIMIT = { google: 25, gateway: 50, fake: 1_000 } as const;

export function dailyLimitFrom(config: {
  CHAT_DAILY_LIMIT?: number;
  CHAT_PROVIDER?: keyof typeof DEFAULT_DAILY_LIMIT;
}): number {
  // The provider fallback covers CI, which skips env validation.
  return config.CHAT_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT[config.CHAT_PROVIDER ?? "google"];
}

export const CHAT_DAILY_LIMIT = dailyLimitFrom(env);

export function dailyLimitMessage(limit = CHAT_DAILY_LIMIT): string {
  return `You've reached today's limit of ${limit} questions. It resets at midnight UTC.`;
}

// Answers generated today (UTC): `chat` usage rows, one per model answer, including "Try
// again". A question no passage matched costs no model call and isn't counted. Usage is written
// when an answer ends, so two answers started at the same moment can both get in under the
// limit; it's a quota guard, not billing.
export async function answersToday(userId: string): Promise<number> {
  return db.$count(
    aiUsage,
    and(
      eq(aiUsage.userId, userId),
      eq(aiUsage.kind, "chat"),
      gte(aiUsage.createdAt, sql`date_trunc('day', now(), 'UTC')`),
    ),
  );
}

export type LimitCheck = { ok: true } | { ok: false; message: string };

export async function checkDailyLimit(
  userId: string,
  limit = CHAT_DAILY_LIMIT,
): Promise<LimitCheck> {
  const used = await answersToday(userId);
  return used < limit ? { ok: true } : { ok: false, message: dailyLimitMessage(limit) };
}
