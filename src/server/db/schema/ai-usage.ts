import "server-only";

import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id, userId } from "./columns";
import { aiUsageKind } from "./enums";

// One row per model call, written after it returns (src/server/ai/usage.ts). Kept for cost
// tracking and the daily chat limit (src/server/ai/limits.ts).
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: userId(),
    kind: aiUsageKind("kind").notNull(),
    // Gateway model ID, e.g. "openai/text-embedding-3-small".
    model: text("model").notNull(),
    // Input plus output.
    tokens: integer("tokens").notNull(),
    // Embeddings have input only. Rows from before 0006 have 0 in both.
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_usage_user_id_idx").on(t.userId),
    // The daily limit: one user's chat rows since midnight UTC.
    index("ai_usage_user_id_kind_created_at_idx").on(t.userId, t.kind, t.createdAt),
  ],
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type AiUsageKind = AiUsage["kind"];
