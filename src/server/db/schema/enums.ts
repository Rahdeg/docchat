import "server-only";

import { pgEnum } from "drizzle-orm/pg-core";

import { feedbackValues, messageStatuses } from "@/features/chat/message";
import { taskCreators } from "@/features/tasks/task-rules";

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "indexing",
  "ready",
  "failed",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

// What a model call in ai_usage was for: indexing a document, embedding a search query,
// answering a question, rewriting a follow-up into a search query, judging an answer (eval), or
// embedding a search from a connected AI app (MCP search_documents, docs/adr/0008). The daily
// chat limit counts `chat` rows.
export const aiUsageKind = pgEnum("ai_usage_kind", [
  "embed-index",
  "embed-query",
  "chat",
  "rewrite",
  "judge",
  "mcp-search",
]);

// How an answer ended. A stopped or failed answer keeps what was generated.
export const messageStatus = pgEnum("message_status", messageStatuses);

export const messageFeedback = pgEnum("message_feedback", feedbackValues);

// Who added a task: the user on the Tasks page, the agent from a chat (after the user approved
// it), or the user's connected AI app over MCP (create_task, docs/adr/0008).
export const taskCreatedBy = pgEnum("task_created_by", taskCreators);

// What a rate-limit event counts, over a sliding window (src/server/rate-limit.ts; the numbers
// are in src/lib/limits.ts): MCP tool calls, searches that embed a query (MCP), upload tokens,
// questions on /chat, and re-reading a document. "search" also counted /chat questions before
// "question" existed.
export const rateLimitBuckets = ["mcp", "search", "upload", "question", "reindex"] as const;
export type RateLimitBucket = (typeof rateLimitBuckets)[number];
export const rateLimitBucket = pgEnum("rate_limit_bucket", rateLimitBuckets);

// What a daily usage counter counts (src/server/rate-limit.ts): questions on /chat (per user,
// and across everyone for the global breaker), task requests, and MCP searches.
export const usageCounterKinds = ["question", "agent-run", "mcp-search"] as const;
export type UsageCounterKind = (typeof usageCounterKinds)[number];
export const usageCounterKind = pgEnum("usage_counter_kind", usageCounterKinds);
