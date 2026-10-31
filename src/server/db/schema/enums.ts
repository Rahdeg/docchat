import "server-only";

import { pgEnum } from "drizzle-orm/pg-core";

import { feedbackValues, messageStatuses } from "@/features/chat/message";

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "indexing",
  "ready",
  "failed",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

// What a model call in ai_usage was for: indexing a document, embedding a search query,
// answering a question, rewriting a follow-up into a search query, or judging an answer (eval).
// The daily chat limit counts `chat` rows.
export const aiUsageKind = pgEnum("ai_usage_kind", [
  "embed-index",
  "embed-query",
  "chat",
  "rewrite",
  "judge",
]);

// How an answer ended. A stopped or failed answer keeps what was generated.
export const messageStatus = pgEnum("message_status", messageStatuses);

export const messageFeedback = pgEnum("message_feedback", feedbackValues);
