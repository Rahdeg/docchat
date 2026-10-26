import { APICallError } from "ai";
import { MockEmbeddingModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "./constants";

const state = vi.hoisted(() => ({
  model: undefined as unknown,
  recordUsage: vi.fn(),
}));

vi.mock("./models", () => ({
  EMBEDDING_MODEL: "test/embedding",
  get embeddingModel() {
    return state.model;
  },
}));
vi.mock("./usage", () => ({ recordUsage: state.recordUsage }));

const { BATCH_MAX_TOKENS, BATCH_MAX_VALUES, embedChunks, embedQuery, toBatches } =
  await import("./embed");

// What the fake provider returns for one request.
type Reply = { embeddings: number[][]; usage?: { tokens: number } };

// A vector that encodes its text, so tests can check which text each vector belongs to.
function vectorFor(text: string): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? Number(text) : 0));
}

function useModel(reply: (options: { values: string[] }) => Promise<Reply>) {
  const model = new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 2048,
    doEmbed: async (options) => ({ ...(await reply(options)), warnings: [] }),
  });
  state.model = model;
  return model;
}

const texts = (count: number, tokenCount = 10) =>
  Array.from({ length: count }, (_, i) => ({ content: String(i), tokenCount }));

beforeEach(() => {
  vi.clearAllMocks();
  state.recordUsage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toBatches", () => {
  it("returns no batches for no texts", () => {
    expect(toBatches([])).toEqual([]);
  });

  it("caps each batch by count", () => {
    const batches = toBatches(texts(BATCH_MAX_VALUES * 2 + 1));
    expect(batches.map((b) => b.length)).toEqual([BATCH_MAX_VALUES, BATCH_MAX_VALUES, 1]);
  });

  it("caps each batch by tokens, keeping order", () => {
    const big = Math.floor(BATCH_MAX_TOKENS / 2);
    const batches = toBatches(texts(5, big));
    expect(batches.map((b) => b.map((t) => t.content))).toEqual([["0", "1"], ["2", "3"], ["4"]]);
  });

  it("gives a text over the token limit a batch of its own", () => {
    const batches = toBatches([
      { content: "a", tokenCount: 10 },
      { content: "b", tokenCount: BATCH_MAX_TOKENS + 1 },
      { content: "c", tokenCount: 10 },
    ]);
    expect(batches.map((b) => b.map((t) => t.content))).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("embedChunks", () => {
  it("makes no calls for no texts", async () => {
    const model = useModel(async () => ({ embeddings: [] }));
    expect(await embedChunks("user_a", [])).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
    expect(state.recordUsage).not.toHaveBeenCalled();
  });

  it("returns vectors in input order even when batches finish out of order", async () => {
    const model = useModel(async ({ values }) => {
      // Earlier batches take longer, so they finish last.
      await new Promise((resolve) => setTimeout(resolve, 30 - Number(values[0]) / 10));
      return { embeddings: values.map(vectorFor), usage: { tokens: values.length * 10 } };
    });
    const input = texts(BATCH_MAX_VALUES * 2 + 5);
    const onBatch = vi.fn();

    const result = await embedChunks("user_a", input, { onBatch });

    expect(model.doEmbedCalls.map((call) => call.values.length)).toEqual([
      BATCH_MAX_VALUES,
      BATCH_MAX_VALUES,
      5,
    ]);
    expect(result.map((v) => v[0])).toEqual(input.map((t) => Number(t.content)));
    expect(onBatch.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("records usage after every request, falling back to our token counts", async () => {
    let call = 0;
    useModel(async ({ values }) => {
      call += 1;
      // The first request reports usage; the second doesn't.
      return { embeddings: values.map(vectorFor), usage: call === 1 ? { tokens: 7 } : undefined };
    });

    await embedChunks("user_a", texts(BATCH_MAX_VALUES + 3, 4));

    const recorded = state.recordUsage.mock.calls.map(([usage]) => usage as { tokens: number });
    expect(recorded).toHaveLength(2);
    expect(state.recordUsage).toHaveBeenCalledWith({
      userId: "user_a",
      kind: "embed-index",
      model: "test/embedding",
      tokens: 7,
    });
    expect(recorded.map((u) => u.tokens).sort((a, b) => a - b)).toEqual([7, 12]);
  });

  it("retries a request that fails with a retryable error", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    useModel(async ({ values }) => {
      attempts += 1;
      if (attempts === 1) {
        throw new APICallError({
          message: "Rate limited",
          url: "https://ai-gateway.vercel.sh",
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
        });
      }
      return { embeddings: values.map(vectorFor) };
    });

    const pending = embedChunks("user_a", texts(2));
    await vi.runAllTimersAsync();

    expect((await pending).map((v) => v[0])).toEqual([0, 1]);
    expect(attempts).toBe(2);
  });

  it("fails when the model returns vectors of the wrong size", async () => {
    useModel(async ({ values }) => ({ embeddings: values.map(() => [0.1, 0.2]) }));

    await expect(embedChunks("user_a", texts(2))).rejects.toThrow();
  });

  it("fails when the model returns too few vectors", async () => {
    useModel(async ({ values }) => ({ embeddings: values.slice(1).map(vectorFor) }));

    await expect(embedChunks("user_a", texts(3))).rejects.toThrow();
  });
});

describe("embedQuery", () => {
  it("embeds the query and records embed-query usage", async () => {
    useModel(async () => ({ embeddings: [vectorFor("3")], usage: { tokens: 5 } }));

    const vector = await embedQuery("user_b", "notice period");

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(state.recordUsage).toHaveBeenCalledWith({
      userId: "user_b",
      kind: "embed-query",
      model: "test/embedding",
      tokens: 5,
    });
  });
});
