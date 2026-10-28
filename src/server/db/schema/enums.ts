import "server-only";

import { pgEnum } from "drizzle-orm/pg-core";

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "indexing",
  "ready",
  "failed",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

// What a model call in ai_usage was for: indexing a document, or embedding a search query.
export const aiUsageKind = pgEnum("ai_usage_kind", ["embed-index", "embed-query"]);
