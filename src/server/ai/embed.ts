import "server-only";

import { embed, embedMany, type EmbeddingModelUsage } from "ai";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { z } from "zod";

import { createModelCaller, retryDelayMs } from "./call-model";
import { EMBEDDING_DIMENSIONS } from "./constants";
import { EMBEDDING_MODEL, embeddingConfig } from "./models";
import { recordUsage } from "./usage";

// The response is an external input: one finite number per dimension, or the batch fails.
const embeddingSchema = z.array(z.number()).length(EMBEDDING_DIMENSIONS);

export type EmbeddableText = {
  content: string;
  // cl100k tokens (docs/adr/0004): exact for OpenAI's models, an estimate for Gemini's.
  tokenCount: number;
};

// Groups texts in order, each group within the provider's per-request limits. A text over the
// token limit on its own still gets a batch of one; chunks are ~500 tokens, so that doesn't
// happen in practice.
export function toBatches<T extends EmbeddableText>(texts: readonly T[]): T[][] {
  const { maxValues, maxTokens } = embeddingConfig.limits;
  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const text of texts) {
    const full = current.length >= maxValues || tokens + text.tokenCount > maxTokens;
    if (current.length > 0 && full) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += text.tokenCount;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

type EmbedChunksOptions = {
  // After each batch is embedded (in completion order), e.g. to show the document is moving.
  onBatch?: (done: number, total: number) => Promise<void> | void;
};

// Embeds a document's chunks for indexing and returns one vector per text, in input order.
// Records an `embed-index` usage row after every request. Throws if any batch still fails
// after its retries, so a document is never stored with some chunks missing a vector.
export async function embedChunks(
  userId: string,
  texts: readonly EmbeddableText[],
  { onBatch }: EmbedChunksOptions = {},
): Promise<number[][]> {
  const batches = toBatches(texts.map((text, index) => ({ ...text, index })));
  const embeddings: number[][] = new Array<number[]>(texts.length);

  let next = 0;
  let done = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < batches.length) {
      const batch = batches[next++]!;
      try {
        const result = await callModel(() =>
          embedMany({
            model: embeddingConfig.model,
            values: batch.map((text) => text.content),
            providerOptions: embeddingConfig.providerOptions("document"),
            maxRetries: 0,
          }),
        );
        await recordUsage({
          userId,
          kind: "embed-index",
          model: EMBEDDING_MODEL,
          tokens: tokensOf(result.usage, batch),
        });
        if (result.embeddings.length !== batch.length) {
          throw new Error(`Expected ${batch.length} embeddings, got ${result.embeddings.length}`);
        }
        batch.forEach((text, i) => {
          embeddings[text.index] = embeddingSchema.parse(result.embeddings[i]);
        });
      } catch (error) {
        failed = true;
        throw error;
      }
      done += 1;
      await onBatch?.(done, batches.length);
    }
  }

  const workers = Math.min(embeddingConfig.limits.parallel, batches.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return embeddings;
}

// Embeds a search query and records an `embed-query` usage row.
export async function embedQuery(userId: string, query: string): Promise<number[]> {
  const result = await callModel(() =>
    embed({
      model: embeddingConfig.model,
      value: query,
      providerOptions: embeddingConfig.providerOptions("query"),
      maxRetries: 0,
    }),
  );
  await recordUsage({
    userId,
    kind: "embed-query",
    model: EMBEDDING_MODEL,
    tokens: tokensOf(result.usage, [{ content: query, tokenCount: countTokens(query) }]),
  });
  return embeddingSchema.parse(result.embedding);
}

// The provider's count when it sends one (Gemini doesn't), otherwise ours.
function tokensOf(usage: EmbeddingModelUsage, texts: readonly EmbeddableText[]): number {
  if (Number.isFinite(usage.tokens) && usage.tokens > 0) return usage.tokens;
  return texts.reduce((sum, text) => sum + text.tokenCount, 0);
}

// Embedding requests share one schedule and retry policy (src/server/ai/call-model.ts).
export const callModel = createModelCaller("Embedding", () => embeddingConfig.limits);

export { retryDelayMs };
