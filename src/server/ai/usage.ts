import "server-only";

import type { LanguageModelUsage } from "ai";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";

import { db } from "@/server/db";
import { aiUsage, type AiUsageKind } from "@/server/db/schema";

type Usage = {
  userId: string;
  kind: AiUsageKind;
  model: string;
  // Input plus output.
  tokens: number;
  // Embeddings have input only, so these default to all input.
  inputTokens?: number;
  outputTokens?: number;
};

// Records one model call. Runs outside any transaction, so tokens spent on a document that
// later fails to index are still counted. A failed write is logged, never thrown: losing a
// usage row shouldn't fail the user's request.
export async function recordUsage({
  outputTokens = 0,
  inputTokens,
  ...usage
}: Usage): Promise<void> {
  await db
    .insert(aiUsage)
    .values({ ...usage, inputTokens: inputTokens ?? usage.tokens - outputTokens, outputTokens })
    .catch((error: unknown) => console.error("Couldn't record AI usage", error));
}

type Generation = {
  userId: string;
  kind: Extract<AiUsageKind, "chat" | "rewrite" | "judge">;
  model: string;
  // The provider's count, when the call finished.
  usage?: LanguageModelUsage;
  // What was sent and received, to estimate with (cl100k) when the provider gave no count,
  // e.g. a stopped answer.
  prompt: string;
  output: string;
};

// Records a text generation: the provider's token counts, or estimates.
export async function recordGeneration({
  usage,
  prompt,
  output,
  ...row
}: Generation): Promise<void> {
  const inputTokens = usage?.inputTokens ?? countTokens(prompt);
  const outputTokens = usage?.outputTokens ?? countTokens(output);
  await recordUsage({ ...row, tokens: inputTokens + outputTokens, inputTokens, outputTokens });
}
