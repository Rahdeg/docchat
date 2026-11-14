import "server-only";

import { z } from "zod";

import type { UploadLimits } from "@/features/documents/upload-rules";

import { env } from "./env";

// Every free-tier limit, in one place (docs/adr/0010). Each number has an env var, so it can be
// changed in Vercel without a code change (a redeploy picks it up; the landing page reads them
// at build time). Server only: client components get the numbers they show as props, and
// refusals carry their numbers in the LimitFailure (src/lib/limit-messages.ts).
//
// Enforced by src/server/rate-limit.ts (windows and daily counters in Postgres), the upload
// routes and registerDocument (documents, file size), indexDocument (pages, duplicates),
// POST /api/chat (questions, agent runs, question length) and the MCP server (tool calls,
// searches).

const count = (fallback: number) => z.coerce.number().int().positive().default(fallback);

// Parsed here rather than trusted from `env`: with SKIP_ENV_VALIDATION (CI, tests) `env`
// hands back the raw strings.
const limitsSchema = z.object({
  // Documents a user can keep, in any state (uploading, reading, ready, problem). Deleting one
  // frees a slot. Users already over it keep theirs but can't add more.
  MAX_DOCUMENTS_PER_USER: count(3),
  // Largest file, in MB. Vercel functions also cap what one indexing run can read in 300 s.
  MAX_FILE_MB: count(10),
  // Pages read from one PDF. Longer ones stop before anything is embedded.
  MAX_PAGES_PER_DOCUMENT: count(50),
  // Questions one user can ask on /chat: a sliding minute, and a UTC day.
  QUESTIONS_PER_MINUTE: count(5),
  QUESTIONS_PER_DAY: count(30),
  // Task requests ("turn this into tasks") per user per UTC day. Each is also a question, and
  // up to AGENT_MAX_STEPS model calls.
  AGENT_RUNS_PER_DAY: count(5),
  // Longest question, in characters (also MCP search queries).
  MAX_QUESTION_CHARS: count(500),
  // Output tokens for one answer, thinking and the citations block included. The longest good
  // eval answer is about 170 tokens of text; answers in the dev database run p95 1,179 output
  // tokens with thinking, so 1,500 leaves room without letting one answer run away.
  MAX_OUTPUT_TOKENS: count(1_500),
  // Output tokens for one agent step: a proposal of eight tasks, each with a quote.
  AGENT_MAX_OUTPUT_TOKENS: count(4_000),
  // Earlier messages sent with a question (3 exchanges), each cut to HISTORY_MESSAGE_CHARS.
  HISTORY_MESSAGES: count(6),
  // Questions across every user per UTC day: the bill's circuit breaker. Applies to everyone,
  // unlimited users included, and also pauses MCP searches.
  GLOBAL_QUESTIONS_PER_DAY: count(2_000),
  // Searches one connected AI app (MCP search_documents) can run per user per UTC day. One
  // embedding each, no chat model call.
  MCP_SEARCHES_PER_DAY: count(200),
  // "Try again" on a document that failed or stopped: each one embeds the document again.
  REINDEX_PER_HOUR: count(10),
  // Clerk user ids that skip every per-user count (documents, questions, agent runs, MCP
  // searches, rate limits). Input limits (file size, pages, question length) and the global
  // breaker still apply. Comma-separated.
  UNLIMITED_USER_IDS: z
    .string()
    .optional()
    .transform(
      (value) =>
        new Set(
          (value ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
    ),
});

export type LimitsEnv = z.input<typeof limitsSchema>;

export function limitsFrom(source: Partial<Record<keyof LimitsEnv, unknown>>) {
  const parsed = limitsSchema.parse(source);
  return {
    maxDocuments: parsed.MAX_DOCUMENTS_PER_USER,
    maxFileMb: parsed.MAX_FILE_MB,
    maxFileBytes: parsed.MAX_FILE_MB * 1024 * 1024,
    maxPages: parsed.MAX_PAGES_PER_DOCUMENT,
    questionsPerMinute: parsed.QUESTIONS_PER_MINUTE,
    questionsPerDay: parsed.QUESTIONS_PER_DAY,
    agentRunsPerDay: parsed.AGENT_RUNS_PER_DAY,
    maxQuestionChars: parsed.MAX_QUESTION_CHARS,
    maxOutputTokens: parsed.MAX_OUTPUT_TOKENS,
    agentMaxOutputTokens: parsed.AGENT_MAX_OUTPUT_TOKENS,
    historyMessages: parsed.HISTORY_MESSAGES,
    globalQuestionsPerDay: parsed.GLOBAL_QUESTIONS_PER_DAY,
    mcpSearchesPerDay: parsed.MCP_SEARCHES_PER_DAY,
    reindexPerHour: parsed.REINDEX_PER_HOUR,
    unlimitedUserIds: parsed.UNLIMITED_USER_IDS as ReadonlySet<string>,
    // Fixed, not free-tier settings: they protect the providers rather than the bill.
    // Calls from a connected AI app, and searches that embed a query (MCP search_documents).
    mcpCallsPerMinute: 60,
    searchesPerMinute: 30,
    // Upload tokens (one per file).
    uploadsPerHour: 20,
    // A follow-up rewritten into a search query.
    rewriteMaxOutputTokens: 120,
    historyMessageChars: 2_000,
  };
}

export type Limits = ReturnType<typeof limitsFrom>;

export const LIMITS: Limits = limitsFrom({
  MAX_DOCUMENTS_PER_USER: env.MAX_DOCUMENTS_PER_USER,
  MAX_FILE_MB: env.MAX_FILE_MB,
  MAX_PAGES_PER_DOCUMENT: env.MAX_PAGES_PER_DOCUMENT,
  QUESTIONS_PER_MINUTE: env.QUESTIONS_PER_MINUTE,
  QUESTIONS_PER_DAY: env.QUESTIONS_PER_DAY,
  AGENT_RUNS_PER_DAY: env.AGENT_RUNS_PER_DAY,
  MAX_QUESTION_CHARS: env.MAX_QUESTION_CHARS,
  MAX_OUTPUT_TOKENS: env.MAX_OUTPUT_TOKENS,
  AGENT_MAX_OUTPUT_TOKENS: env.AGENT_MAX_OUTPUT_TOKENS,
  HISTORY_MESSAGES: env.HISTORY_MESSAGES,
  GLOBAL_QUESTIONS_PER_DAY: env.GLOBAL_QUESTIONS_PER_DAY,
  MCP_SEARCHES_PER_DAY: env.MCP_SEARCHES_PER_DAY,
  REINDEX_PER_HOUR: env.REINDEX_PER_HOUR,
  UNLIMITED_USER_IDS: env.UNLIMITED_USER_IDS,
});

export function isUnlimited(userId: string, limits: Limits = LIMITS): boolean {
  return limits.unlimitedUserIds.has(userId);
}

// Null for an unlimited user.
export function documentLimitFor(userId: string, limits: Limits = LIMITS): number | null {
  return isUnlimited(userId, limits) ? null : limits.maxDocuments;
}

// What the Library needs for its own checks and notes (the server checks again).
export type LibraryLimits = UploadLimits & { maxPages: number };

export function libraryLimits(userId: string): LibraryLimits {
  return {
    maxDocuments: documentLimitFor(userId),
    maxFileBytes: LIMITS.maxFileBytes,
    maxPages: LIMITS.maxPages,
  };
}
