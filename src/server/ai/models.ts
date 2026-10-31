import "server-only";

import {
  createGoogleGenerativeAI,
  type GoogleEmbeddingModelOptions,
  type GoogleLanguageModelOptions,
} from "@ai-sdk/google";
import {
  createGateway,
  type embed,
  type EmbeddingModel,
  type generateText,
  type LanguageModel,
} from "ai";

import { env } from "@/lib/env";

import { EMBEDDING_DIMENSIONS } from "./constants";

// The "gateway" chat and embedding providers go through Vercel AI Gateway
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
    // Gemini's scores sit in a narrow, high band. First eval run (2026-10-27): right passages
    // 0.599 to 0.745, off-topic questions at most 0.503, the on-topic no-answer question 0.640.
    // 0.58 hides unrelated questions, including ones about DocChat itself, and keeps every
    // right passage (lowest 0.599; docs/adr/0005, recalibrated in docs/adr/0006).
    minSimilarity: 0.58,
  },
  // Vercel AI Gateway (paid credits): production. OpenAI caps a request at 2048 inputs and about
  // 300k tokens; smaller batches keep a retry cheap.
  gateway: {
    id: "openai/text-embedding-3-small",
    dimensions: 1536,
    model: gateway.embeddingModel("openai/text-embedding-3-small"),
    providerOptions: () => undefined,
    limits: { maxValues: 100, maxTokens: 50_000, parallel: 3, minIntervalMs: 0, maxRetries: 3 },
    // Not calibrated yet: run the eval with EMBEDDING_PROVIDER=gateway before launch.
    minSimilarity: 0.25,
  },
};

// Validated env defaults to "google"; the fallback covers CI, which skips validation.
export const EMBEDDING_PROVIDER: EmbeddingProvider = env.EMBEDDING_PROVIDER ?? "google";

export const embeddingConfig = EMBEDDING_CONFIGS[EMBEDDING_PROVIDER];

// Changing models means re-embedding every chunk; compare the two with `pnpm eval:retrieval`.
export const EMBEDDING_MODEL = embeddingConfig.id;

export const MIN_SIMILARITY = embeddingConfig.minSimilarity;

// Whether the configured provider has a key here. Tests that embed for real skip without one.
// (On Vercel the gateway can authenticate with OIDC instead.)
export const hasEmbeddingKey =
  EMBEDDING_PROVIDER === "google" ? !!env.GOOGLE_GENERATIVE_AI_API_KEY : !!env.AI_GATEWAY_API_KEY;

// Chat (docs/adr/0006). Three jobs, each with its own model: answering, rewriting a follow-up
// into a standalone search query (small and cheap), and judging answers in the eval.
export type ChatProvider = "google" | "gateway";
export type ChatTask = "answer" | "rewrite" | "judge";

export type ChatModel = {
  // Stored in ai_usage.model.
  id: string;
  // A model instance (not a gateway id string), so it can be wrapped with middleware.
  model: Exclude<LanguageModel, string>;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
};

export type ChatConfig = {
  models: Record<ChatTask, ChatModel>;
  // Shared by every chat request in this process (src/server/ai/call-model.ts).
  limits: { minIntervalMs: number; maxRetries: number; maxDelayMs: number };
};

// Gemini 3 models think before answering; "low" keeps answers quick, "minimal" is enough for
// rewriting a query or a yes/no judgement.
const thinking = (thinkingLevel: "minimal" | "low") => ({
  google: { thinkingConfig: { thinkingLevel } } satisfies GoogleLanguageModelOptions,
});

export const CHAT_CONFIGS: Record<ChatProvider, ChatConfig> = {
  // Gemini API free tier: fictional documents only, like embeddings. gemini-3.8-flash is the
  // newest Flash model with a free tier (pricing page, 2026-10-28), but its free tier was
  // overloaded that day: 60 s timeouts and 503s. gemini-3.6-flash, the next newest, answered
  // in about 3 s. Try 3.8 again with CHAT_ANSWER_MODEL. Flash-Lite rewrites queries.
  //
  // The free tier allows 20 requests a day per model for the whole project (429
  // GenerateRequestsPerDayPerProjectPerModel-FreeTier, 2026-10-28), so it binds before
  // CHAT_DAILY_LIMIT does. It also answers 503 under load, so requests are spaced out and
  // retried.
  google: {
    models: {
      answer: {
        id: "google/gemini-3.6-flash",
        model: google("gemini-3.6-flash"),
        providerOptions: thinking("low"),
      },
      rewrite: {
        id: "google/gemini-3.5-flash-lite",
        model: google("gemini-3.5-flash-lite"),
        providerOptions: thinking("minimal"),
      },
      // An open model on the same API, with its own free quota: the eval's judge calls don't
      // use up the answer model's 20 requests a day.
      judge: { id: "google/gemma-4-26b-a4b-it", model: google("gemma-4-26b-a4b-it") },
    },
    // The free tier's per-minute quota is small (a 429 after a burst of tests on 2026-10-28).
    // A short wait is worth it; a long one, the user is better off told to try again.
    limits: { minIntervalMs: 1_000, maxRetries: 3, maxDelayMs: 20_000 },
  },
  // Vercel AI Gateway (paid credits): production.
  gateway: {
    models: {
      answer: { id: "anthropic/claude-sonnet-5.5", model: gateway("anthropic/claude-sonnet-5.5") },
      rewrite: { id: "anthropic/claude-haiku-5.5", model: gateway("anthropic/claude-haiku-5.5") },
      judge: { id: "anthropic/claude-haiku-5.5", model: gateway("anthropic/claude-haiku-5.5") },
    },
    limits: { minIntervalMs: 0, maxRetries: 2, maxDelayMs: 10_000 },
  },
};

// Validated env defaults to "google"; the fallback covers CI, which skips validation.
export const CHAT_PROVIDER: ChatProvider = env.CHAT_PROVIDER ?? "google";

// CHAT_ANSWER_MODEL swaps the answer model on the same provider.
export const chatConfig: ChatConfig = withAnswerModel(
  CHAT_CONFIGS[CHAT_PROVIDER],
  env.CHAT_ANSWER_MODEL,
);

function withAnswerModel(config: ChatConfig, modelId: string | undefined): ChatConfig {
  if (!modelId) return config;
  const answer: ChatModel =
    CHAT_PROVIDER === "google"
      ? {
          id: `google/${modelId}`,
          model: google(modelId),
          providerOptions: config.models.answer.providerOptions,
        }
      : { id: modelId, model: gateway(modelId) };
  return { ...config, models: { ...config.models, answer } };
}

// Whether the chat provider has a key here. Tests that generate for real skip without one.
export const hasChatKey =
  CHAT_PROVIDER === "google" ? !!env.GOOGLE_GENERATIVE_AI_API_KEY : !!env.AI_GATEWAY_API_KEY;
