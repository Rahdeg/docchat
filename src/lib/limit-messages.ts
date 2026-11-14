// Refusals for free-tier limits (docs/adr/0010): a code plus the numbers the message needs.
// Server Actions return them as `limit` on a failed ActionResult, route handlers as JSON
// `{ error, limit }` with status 429 (or 400/413 for input limits). limitMessage is the one
// place that words them; the server uses it too (the `error` text, MCP results, a document's
// problem message). No server-only imports: this file ships to the browser.

import { z } from "zod";

export const limitFailureSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("DOCUMENT_LIMIT"), max: z.number() }),
  z.object({
    code: z.literal("FILE_TOO_LARGE"),
    maxMb: z.number(),
    sizeBytes: z.number(),
    fileName: z.string(),
  }),
  z.object({ code: z.literal("TOO_MANY_PAGES"), max: z.number(), pages: z.number() }),
  z.object({ code: z.literal("DUPLICATE_DOCUMENT"), existingName: z.string() }),
  z.object({ code: z.literal("QUESTION_TOO_LONG"), max: z.number() }),
  z.object({
    code: z.literal("QUESTIONS_PER_MINUTE"),
    max: z.number(),
    retryAfterSeconds: z.number(),
  }),
  z.object({ code: z.literal("QUESTIONS_PER_DAY"), max: z.number() }),
  z.object({ code: z.literal("AGENT_RUNS_PER_DAY"), max: z.number() }),
  z.object({ code: z.literal("MCP_SEARCHES_PER_DAY"), max: z.number() }),
  z.object({ code: z.literal("GLOBAL_PAUSED") }),
  z.object({
    code: z.literal("RATE_LIMITED"),
    bucket: z.enum(["mcp", "search", "upload", "reindex"]),
    max: z.number(),
    retryAfterSeconds: z.number(),
  }),
]);

export type LimitFailure = z.infer<typeof limitFailureSchema>;
export type LimitCode = LimitFailure["code"];

// Daily limits reset at midnight UTC (src/server/rate-limit.ts). In winter that's midnight in
// the UK too; in summer it's 1 am UK time, so the message names UTC.
export const DAILY_RESET = "midnight UTC";

export function waitText(seconds: number): string {
  if (seconds < 60) {
    const s = Math.max(1, Math.ceil(seconds));
    return `${s} second${s === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// Rounded up to a tenth, so a file just over the limit never reads as the limit itself.
function megabytes(bytes: number): string {
  const tenths = Math.ceil(bytes / (1024 * 1024) / 0.1 - 1e-9);
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} MB`;
}

export function limitMessage(failure: LimitFailure): string {
  switch (failure.code) {
    case "DOCUMENT_LIMIT":
      return `You've reached the free limit of ${failure.max} documents. Delete one to upload another.`;
    case "FILE_TOO_LARGE":
      return `${failure.fileName} is ${megabytes(failure.sizeBytes)}. The free limit is ${failure.maxMb} MB per file.`;
    case "TOO_MANY_PAGES":
      return `This PDF has ${failure.pages} pages. The free limit is ${failure.max}.`;
    case "DUPLICATE_DOCUMENT":
      return `You already have this file as "${failure.existingName}".`;
    case "QUESTION_TOO_LONG":
      return `Questions can be up to ${failure.max} characters. Try a shorter one.`;
    case "QUESTIONS_PER_MINUTE":
      return `You're asking quickly. Try again in ${waitText(failure.retryAfterSeconds)}.`;
    case "QUESTIONS_PER_DAY":
      return `You've used today's ${failure.max} questions. They reset at ${DAILY_RESET}.`;
    case "AGENT_RUNS_PER_DAY":
      return `You've used today's ${failure.max} task requests. They reset at ${DAILY_RESET}. You can still ask questions.`;
    case "MCP_SEARCHES_PER_DAY":
      return `Your AI app has used today's ${failure.max} DocChat searches. They reset at ${DAILY_RESET}.`;
    case "GLOBAL_PAUSED":
      return "DocChat is very busy today, so new questions are paused until tomorrow. Your documents are safe.";
    case "RATE_LIMITED": {
      const wait = waitText(failure.retryAfterSeconds);
      switch (failure.bucket) {
        case "mcp":
          return `Your AI app has made ${failure.max} requests to DocChat in the last minute. Try again in ${wait}.`;
        case "search":
          return `That's a lot of searches in a minute. Try again in ${wait}.`;
        case "upload":
          return `You've uploaded ${failure.max} files in the last hour. You can upload more in ${wait}.`;
        case "reindex":
          return `You've asked DocChat to read documents again ${failure.max} times in the last hour. Try again in ${wait}.`;
      }
    }
  }
}

// A route handler's limit refusal: JSON `{ error, limit }`. Anything else (plain text, another
// JSON shape) is null.
export function parseLimitBody(body: string): LimitFailure | null {
  try {
    const parsed = z.object({ limit: limitFailureSchema }).safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.limit : null;
  } catch {
    return null;
  }
}
