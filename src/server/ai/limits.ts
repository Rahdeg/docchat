import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/server/db";
import { aiUsage } from "@/server/db/schema";

// Answers per user per UTC day: CHAT_DAILY_LIMIT, or by provider. The Gemini free tier allows
// about 20 answers a day for the whole project, so one user gets 10 of them; the gateway is paid.
export function dailyLimitFrom(config: {
  CHAT_DAILY_LIMIT?: number;
  CHAT_PROVIDER?: "google" | "gateway";
}): number {
  // The provider fallback covers CI, which skips env validation.
  return config.CHAT_DAILY_LIMIT ?? ((config.CHAT_PROVIDER ?? "google") === "google" ? 10 : 50);
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
