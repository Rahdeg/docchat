import "server-only";

import type { LimitCode } from "@/lib/limit-messages";

// Structured server logs (docs/adr/0009): one JSON line per important event, for Vercel's
// logs (or any log drain) to filter and count. Every event has a fixed set of fields: ids,
// counts, durations, model names and error kinds. Never free text: no document text, passages,
// prompts, answers, titles, file names or emails. The Clerk user id is the only identifier.

type Id = string;

export type LogEvents = {
  "document.indexed": {
    userId: Id;
    documentId: Id;
    pages: number;
    chunks: number;
    durationMs: number;
    model: string;
  };
  "document.index_failed": { userId: Id; documentId: Id; durationMs: number; error: string };
  "answer.generated": {
    userId: Id;
    mode: "answer" | "agent";
    model: string;
    status: "complete" | "stopped" | "failed";
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
    // Agent runs: model calls made.
    steps?: number;
  };
  "agent.approved": { userId: Id; chatId: Id; proposed: number; added: number };
  "agent.cancelled": { userId: Id; chatId: Id; proposed: number };
  // A limit stopped a request: the provider's quota, or one of ours (a LimitFailure code,
  // src/lib/limit-messages.ts).
  "quota.hit": { userId: Id; limit: "provider" | LimitCode };
};

type Level = "info" | "warn" | "error";

export function log<E extends keyof LogEvents>(
  event: E,
  fields: LogEvents[E],
  level: Level = "info",
): void {
  // Vitest runs print nothing unless asked.
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// What kind of error it was, without its message (messages can quote documents): the class
// name, plus the HTTP status or system code when there is one.
export function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const extra = error as { statusCode?: unknown; code?: unknown };
  const detail =
    typeof extra.statusCode === "number"
      ? extra.statusCode
      : typeof extra.code === "string" && /^[A-Z_]{2,40}$/.test(extra.code)
        ? extra.code
        : null;
  return detail === null ? error.name : `${error.name}:${detail}`;
}

export function since(start: number): number {
  return Math.round(performance.now() - start);
}
