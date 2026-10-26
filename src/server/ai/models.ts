import "server-only";

import { createGateway } from "ai";

import { env } from "@/lib/env";

// Every model call goes through Vercel AI Gateway (docs/adr/0005). With no key it falls back to
// the Vercel OIDC token, which is how deployments on Vercel authenticate.
export const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

// Output size of each embedding model we know. A unit test checks the current model against
// EMBEDDING_DIMENSIONS, so switching models can't silently mismatch the vector column.
export const EMBEDDING_MODEL_DIMENSIONS = {
  "openai/text-embedding-3-small": 1536,
  "openai/text-embedding-3-large": 3072,
} as const;

export type EmbeddingModelId = keyof typeof EMBEDDING_MODEL_DIMENSIONS;

// Changing this means re-embedding every chunk; compare the two with `pnpm eval:retrieval` first.
export const EMBEDDING_MODEL: EmbeddingModelId = "openai/text-embedding-3-small";

export const embeddingModel = gateway.embeddingModel(EMBEDDING_MODEL);

// Passages below this cosine similarity aren't shown on /chat. Calibrated with the retrieval
// eval: between the best score of a question the documents can't answer and the lowest score of
// a correct passage (docs/adr/0005). searchPassages has no floor by default, so the eval still
// measures raw ranking.
export const MIN_SIMILARITY = 0.25;
