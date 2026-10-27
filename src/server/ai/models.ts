import "server-only";

import { createGoogleGenerativeAI, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { createGateway, type embed, type EmbeddingModel } from "ai";

import { env } from "@/lib/env";

import { EMBEDDING_DIMENSIONS } from "./constants";

// Chat (PR 6) and the "gateway" embedding provider go through Vercel AI Gateway
// (docs/adr/0005). With no key it falls back to the Vercel OIDC token, which is how deployments
// on Vercel authenticate.
export const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });

export type EmbeddingProvider = "google" | "gateway";
// Some models embed documents and questions differently (asymmetric retrieval).
export type EmbeddingTask = "document" | "query";
type ProviderOptions = Parameters<typeof embed>[0]["providerOptions"];

export type EmbeddingConfig = {
  // Stored on every chunk (chunk.embedding_model). Vectors from different models aren't
  // comparable, so search only uses chunks embedded by the current model, and the backfill
  // re-embeds the rest.
  id: string;
  // Output size as configured; must equal EMBEDDING_DIMENSIONS (a unit test checks).
  dimensions: number;
  model: EmbeddingModel;
  providerOptions: (task: EmbeddingTask) => ProviderOptions;
  limits: {
    // Per request.
    maxValues: number;
    maxTokens: number;
    // Requests in flight at once, and the minimum gap between starting two.
    parallel: number;
    minIntervalMs: number;
    // Per request, on rate limits (429) and server errors (src/server/ai/embed.ts).
    maxRetries: number;
  };
  // Passages below this cosine similarity aren't shown on /chat. Scores depend on the model, so
  // each has its own, calibrated with `pnpm eval:retrieval` (docs/adr/0005).
  minSimilarity: number;
};

export const EMBEDDING_CONFIGS: Record<EmbeddingProvider, EmbeddingConfig> = {
  // Gemini API free tier: development with fictional documents only (Google may use free-tier
  // content to improve its products). gemini-embedding-001 outputs 3072 dimensions; we ask for
  // 1536 so the column stays the same. Cosine similarity doesn't need the shortened vectors to
  // be normalised. The free tier allows about 100 requests a minute, so requests are small,
  // one at a time and spaced out, with long backoff on 429.
  google: {
    id: "google/gemini-embedding-001",
    dimensions: 1536,
    model: google.embedding("gemini-embedding-001"),
    providerOptions: (task) => ({
      google: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: task === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
      } satisfies GoogleEmbeddingModelOptions,
    }),
    limits: { maxValues: 20, maxTokens: 10_000, parallel: 1, minIntervalMs: 700, maxRetries: 6 },
    minSimilarity: 0.25,
  },
  // Vercel AI Gateway (paid credits): production. OpenAI caps a request at 2048 inputs and about
  // 300k tokens; smaller batches keep a retry cheap.
  gateway: {
    id: "openai/text-embedding-3-small",
    dimensions: 1536,
    model: gateway.embeddingModel("openai/text-embedding-3-small"),
    providerOptions: () => undefined,
    limits: { maxValues: 100, maxTokens: 50_000, parallel: 3, minIntervalMs: 0, maxRetries: 3 },
    minSimilarity: 0.25,
  },
};

// Validated env defaults to "google"; the fallback covers CI, which skips validation.
export const EMBEDDING_PROVIDER: EmbeddingProvider = env.EMBEDDING_PROVIDER ?? "google";

export const embeddingConfig = EMBEDDING_CONFIGS[EMBEDDING_PROVIDER];

// Changing models means re-embedding every chunk; compare the two with `pnpm eval:retrieval`.
export const EMBEDDING_MODEL = embeddingConfig.id;

export const MIN_SIMILARITY = embeddingConfig.minSimilarity;
