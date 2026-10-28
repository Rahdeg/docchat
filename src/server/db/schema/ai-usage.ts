import "server-only";

import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id, userId } from "./columns";
import { aiUsageKind } from "./enums";

// One row per model call, written after it returns (src/server/ai/usage.ts). Kept for rate
// limits and cost tracking; nothing reads it yet.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: userId(),
    kind: aiUsageKind("kind").notNull(),
    // Gateway model ID, e.g. "openai/text-embedding-3-small".
    model: text("model").notNull(),
    tokens: integer("tokens").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_id_idx").on(t.userId)],
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type AiUsageKind = AiUsage["kind"];
