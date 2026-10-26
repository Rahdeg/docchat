import "server-only";

import { embed, embedMany, type EmbeddingModelUsage } from "ai";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { z } from "zod";

import { EMBEDDING_DIMENSIONS } from "./constants";
import { EMBEDDING_MODEL, embeddingModel } from "./models";
import { recordUsage } from "./usage";

// OpenAI's embeddings endpoint takes at most 2048 inputs and ~300k tokens per request, and the
// gateway only splits by count. Much smaller batches keep each request quick and a retry cheap.
export const BATCH_MAX_VALUES = 100;
export const BATCH_MAX_TOKENS = 50_000;
// Batches in flight at once for one document.
const PARALLEL_BATCHES = 3;
// Per request, on rate limits and server errors. The SDK backs off (2 s, 4 s, 8 s) and honours
// retry-after.
const MAX_RETRIES = 3;

// The response is an external input: one finite number per dimension, or the batch fails.
const embeddingSchema = z.array(z.number()).length(EMBEDDING_DIMENSIONS);

export type EmbeddableText = {
  content: string;
  // cl100k tokens, the tokenizer of the embedding model (docs/adr/0004).
  tokenCount: number;
};

// Groups texts in order, each group within both limits. A text over the token limit on its own
// still gets a batch of one; chunks are ~500 tokens, so that never happens in practice.
export function toBatches<T extends EmbeddableText>(texts: readonly T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const text of texts) {
    const full = current.length >= BATCH_MAX_VALUES || tokens + text.tokenCount > BATCH_MAX_TOKENS;
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
        const result = await embedMany({
          model: embeddingModel,
          values: batch.map((text) => text.content),
          maxRetries: MAX_RETRIES,
        });
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

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, () => worker()),
  );
  return embeddings;
}

// Embeds a search query and records an `embed-query` usage row.
export async function embedQuery(userId: string, query: string): Promise<number[]> {
  const result = await embed({ model: embeddingModel, value: query, maxRetries: MAX_RETRIES });
  await recordUsage({
    userId,
    kind: "embed-query",
    model: EMBEDDING_MODEL,
    tokens: tokensOf(result.usage, [{ content: query, tokenCount: countTokens(query) }]),
  });
  return embeddingSchema.parse(result.embedding);
}

// The provider's count when it sends one, otherwise ours (the same tokenizer).
function tokensOf(usage: EmbeddingModelUsage, texts: readonly EmbeddableText[]): number {
  if (Number.isFinite(usage.tokens) && usage.tokens > 0) return usage.tokens;
  return texts.reduce((sum, text) => sum + text.tokenCount, 0);
}
