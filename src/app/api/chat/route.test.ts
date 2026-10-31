import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ABOUT_ANSWER } from "@/features/chat/about";
import { FREE_LIMIT_MESSAGE } from "@/features/chat/message";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkDailyLimit: vi.fn(),
  ensureChat: vi.fn(),
  saveUserMessage: vi.fn(),
  deleteMessagesAfter: vi.fn(),
  saveAnswer: vi.fn(),
  listMessages: vi.fn(),
  listReadyDocuments: vi.fn(),
  searchPassages: vi.fn(),
  recordGeneration: vi.fn(),
  models: {
    answer: { id: "test/answer", model: undefined as unknown },
    rewrite: { id: "test/rewrite", model: undefined as unknown },
    judge: { id: "test/judge", model: undefined as unknown },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/server/ai/limits", () => ({ checkDailyLimit: mocks.checkDailyLimit }));
vi.mock("@/features/chat/mutations", () => ({
  ensureChat: mocks.ensureChat,
  saveUserMessage: mocks.saveUserMessage,
  deleteMessagesAfter: mocks.deleteMessagesAfter,
  saveAnswer: mocks.saveAnswer,
}));
vi.mock("@/features/chat/queries", () => ({ listMessages: mocks.listMessages }));
vi.mock("@/features/documents/queries", () => ({ listReadyDocuments: mocks.listReadyDocuments }));
vi.mock("@/server/ai/retrieve", () => ({ searchPassages: mocks.searchPassages }));
vi.mock("@/server/ai/usage", () => ({ recordGeneration: mocks.recordGeneration }));
vi.mock("@/server/ai/models", () => ({
  MIN_SIMILARITY: 0.55,
  chatConfig: { models: mocks.models, limits: { minIntervalMs: 0, maxRetries: 0 } },
}));

const { POST } = await import("./route");

const alice = "user_alice";
const chatId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const questionId = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const question = "How much notice does my landlord need to give before raising the rent?";
const clause =
  "7.3 Any increase applies from the next rent payment date. 7.4 The Landlord must give the " +
  "Tenant not less than one month’s notice in writing of any rent increase.";

const passage = (n: number, content: string) => ({
  chunkId: `00000000-0000-4000-8000-00000000000${n}`,
  documentId: "11111111-1111-4111-8111-111111111111",
  name: "Tenancy agreement.pdf",
  mimeType: "application/pdf",
  hasFile: true,
  page: 3,
  content,
  startOffset: 0,
  endOffset: content.length,
  similarity: 0.7,
});
const passages = [passage(1, "5.1 The rent is 1,150 pounds a month."), passage(2, clause)];

function body(overrides: Record<string, unknown> = {}) {
  return {
    chatId,
    trigger: "submit-message",
    message: { id: questionId, role: "user", parts: [{ type: "text", text: question }] },
    ...overrides,
  };
}

const ask = (text: string) => ({ id: questionId, role: "user", parts: [{ type: "text", text }] });

function post(payload: unknown) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

// The UI message chunks of a streamed (SSE) response.
async function chunks(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

const textOf = (all: Record<string, unknown>[]) =>
  all.flatMap((c) => (c.type === "text-delta" ? [c.delta as string] : [])).join("");

// A model that streams `text` in small pieces, as providers do.
function modelWriting(text: string) {
  const pieces = text.match(/[\s\S]{1,7}/g) ?? [];
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start" as const, id: "t" },
          ...pieces.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end" as const, id: "t" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: {
              inputTokens: {
                total: 900,
                noCache: 900,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 60, text: 60, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

// What the Gemini API answers when a quota is used up.
function quotaError(quota = "GenerateRequestsPerDayPerProjectPerModel-FreeTier") {
  return new APICallError({
    message: "You exceeded your current quota.",
    url: "https://generativelanguage.googleapis.com/",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: JSON.stringify({
      error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ quotaId: quota }] },
    }),
    isRetryable: true,
  });
}

const followUpHistory = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    role: "user",
    parts: [{ type: "text", text: "Can I keep a cat?" }],
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    role: "assistant",
    parts: [{ type: "text", text: "Only with consent [1]." }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: alice });
  mocks.checkDailyLimit.mockResolvedValue({ ok: true });
  mocks.ensureChat.mockResolvedValue({ id: chatId, userId: alice, title: "Rent" });
  mocks.saveUserMessage.mockResolvedValue(new Date("2026-10-28T10:00:00Z"));
  mocks.listMessages.mockResolvedValue([]);
  mocks.listReadyDocuments.mockResolvedValue([
    { id: "11111111-1111-4111-8111-111111111111", name: "Tenancy agreement.pdf" },
  ]);
  mocks.searchPassages.mockResolvedValue(passages);
  mocks.models.answer.model = modelWriting(
    "At least one month's notice in writing [2].\n\n<citations>\n" +
      '{"source": 2, "quote": "The Landlord must give the Tenant not less than one month\'s notice in writing of any rent increase."}\n' +
      "</citations>",
  );
});

describe("POST /api/chat", () => {
  it("returns 401 to signed-out visitors", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    expect((await post(body())).status).toBe(401);
    expect(mocks.ensureChat).not.toHaveBeenCalled();
  });

  it.each([
    ["a chat id that isn't a uuid", body({ chatId: "../x" })],
    ["an assistant message", body({ message: { id: questionId, role: "assistant", parts: [] } })],
    [
      "a too-short question",
      body({ message: { id: questionId, role: "user", parts: [{ type: "text", text: " a " }] } }),
    ],
    ["no body", null],
  ])("returns 400 for %s", async (_label, payload) => {
    expect((await post(payload)).status).toBe(400);
    expect(mocks.saveUserMessage).not.toHaveBeenCalled();
  });

  it("refuses with the daily limit message before any model call or write", async () => {
    mocks.checkDailyLimit.mockResolvedValue({
      ok: false,
      message: "You've reached today's limit of 50 questions. It resets at midnight UTC.",
    });

    const response = await post(body());

    expect(response.status).toBe(429);
    expect(await response.text()).toBe(
      "You've reached today's limit of 50 questions. It resets at midnight UTC.",
    );
    expect(mocks.ensureChat).not.toHaveBeenCalled();
    expect(mocks.searchPassages).not.toHaveBeenCalled();
    expect(mocks.checkDailyLimit).toHaveBeenCalledWith(alice);
  });

  it("returns 404 for another user's chat, without saving or searching", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_bob" });
    mocks.ensureChat.mockResolvedValue(null);

    const response = await post(body());

    expect(response.status).toBe(404);
    expect(mocks.ensureChat).toHaveBeenCalledWith("user_bob", chatId, expect.any(String));
    expect(mocks.saveUserMessage).not.toHaveBeenCalled();
    expect(mocks.searchPassages).not.toHaveBeenCalled();
  });

  it("creates the chat titled after the first question and saves it straight away", async () => {
    await chunks(await post(body()));

    expect(mocks.ensureChat).toHaveBeenCalledWith(
      alice,
      chatId,
      "How much notice does my landlord need to give before raising…",
    );
    expect(mocks.saveUserMessage).toHaveBeenCalledWith(alice, chatId, {
      id: questionId,
      role: "user",
      parts: [{ type: "text", text: question }],
    });
  });

  it("streams a cited answer, renumbered, with the quote found in the passage", async () => {
    const all = await chunks(await post(body({ documentIds: [passages[0]!.documentId] })));

    expect(mocks.searchPassages).toHaveBeenCalledWith({
      userId: alice,
      query: question,
      documentIds: [passages[0]!.documentId],
      limit: 5,
      minSimilarity: 0.55,
    });
    expect(textOf(all)).toBe("At least one month's notice in writing [1].");
    expect(all.find((c) => c.type === "data-passages")).toMatchObject({
      data: { query: question, passages },
    });
    const final = all.filter((c) => c.type === "data-citations").at(-1);
    expect(final).toMatchObject({
      data: { final: true, citations: [{ number: 1, source: 2, matched: true }] },
    });
    const [citation] = (final!.data as { citations: { start: number; end: number }[] }).citations;
    expect(clause.slice(citation!.start, citation!.end)).toBe(
      "7.4 The Landlord must give the Tenant not less than one month’s notice in writing of any rent increase.",
    );

    await vi.waitFor(() => expect(mocks.saveAnswer).toHaveBeenCalled());
    const [user, chat, saved, status] = mocks.saveAnswer.mock.calls[0]!;
    expect([user, chat, status]).toEqual([alice, chatId, "complete"]);
    expect(saved.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: "At least one month's notice in writing [1].",
        }),
        expect.objectContaining({ type: "data-citations", data: final!.data }),
      ]),
    );
    expect(mocks.recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: alice, kind: "chat", model: "test/answer" }),
    );
  });

  it("answers 'don't say' without calling the model when no passage clears the floor", async () => {
    mocks.searchPassages.mockResolvedValue([]);
    const doStream = vi.fn();
    mocks.models.answer.model = new MockLanguageModelV4({ doStream });

    const all = await chunks(await post(body()));

    expect(doStream).not.toHaveBeenCalled();
    expect(mocks.recordGeneration).not.toHaveBeenCalled();
    expect(textOf(all)).toMatch(
      /^Your documents don't say anything about that\. Nothing in your documents \(Tenancy agreement\)/,
    );
    expect(all.filter((c) => c.type === "data-citations").at(-1)).toMatchObject({
      data: { final: true, citations: [] },
    });
    await vi.waitFor(() => expect(mocks.saveAnswer).toHaveBeenCalled());
    expect(mocks.saveAnswer.mock.calls[0]![3]).toBe("complete");
  });

  it("streams the model's one-line 'don't say' for an unrelated question, citing nothing", async () => {
    mocks.models.answer.model = modelWriting("Your documents don't say anything about that. [1]");

    const all = await chunks(await post(body({ message: ask("What's the capital of France?") })));

    expect(textOf(all)).toBe("Your documents don't say anything about that.");
    expect(all.filter((c) => c.type === "data-citations").at(-1)).toMatchObject({
      data: { final: true, citations: [] },
    });
  });

  it.each(["are you fraudstar", "Are you a fraudster?", "What can you do?", "Who are you?"])(
    "answers %j with the line about DocChat, without searching or calling a model",
    async (text) => {
      const doStream = vi.fn();
      mocks.models.answer.model = new MockLanguageModelV4({ doStream });

      const all = await chunks(await post(body({ message: ask(text) })));

      expect(textOf(all)).toBe(ABOUT_ANSWER);
      expect(mocks.searchPassages).not.toHaveBeenCalled();
      expect(doStream).not.toHaveBeenCalled();
      expect(mocks.recordGeneration).not.toHaveBeenCalled();
      expect(all.some((c) => c.type === "data-passages" || c.type === "data-citations")).toBe(
        false,
      );
      await vi.waitFor(() => expect(mocks.saveAnswer).toHaveBeenCalled());
      const [, , saved, status] = mocks.saveAnswer.mock.calls[0]!;
      expect(status).toBe("complete");
      expect(saved.parts).toEqual([expect.objectContaining({ type: "text", text: ABOUT_ANSWER })]);
    },
  );

  it.each([
    ["the daily quota", quotaError()],
    ["a per-minute rate limit", quotaError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")],
  ])(
    "when the answer model refuses for %s, keeps the question, saves no answer and says so",
    async (_label, error) => {
      mocks.models.answer.model = new MockLanguageModelV4({
        doStream: async () => {
          throw error;
        },
      });

      const response = await post(body());
      const all = await chunks(response);

      expect(response.status).toBe(200);
      expect(mocks.saveUserMessage).toHaveBeenCalled();
      expect(all).toContainEqual({ type: "error", errorText: FREE_LIMIT_MESSAGE });
      expect(all.some((c) => c.type === "finish")).toBe(false);
      // onEnd runs after the stream closes: give it the chance to (wrongly) save.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mocks.saveAnswer).not.toHaveBeenCalled();
      expect(mocks.recordGeneration).not.toHaveBeenCalled();
    },
  );

  it("says the same when the embedding provider refuses the search for quota", async () => {
    mocks.searchPassages.mockRejectedValue(quotaError());

    const all = await chunks(await post(body()));

    expect(mocks.saveUserMessage).toHaveBeenCalled();
    expect(all).toContainEqual({ type: "error", errorText: FREE_LIMIT_MESSAGE });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.saveAnswer).not.toHaveBeenCalled();
  });

  it("still saves a failed answer for other errors", async () => {
    mocks.models.answer.model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("socket hang up");
      },
    });

    const all = await chunks(await post(body()));

    expect(all).toContainEqual({
      type: "error",
      errorText: "Something went wrong while writing the answer. Try again.",
    });
    await vi.waitFor(() => expect(mocks.saveAnswer).toHaveBeenCalled());
    expect(mocks.saveAnswer.mock.calls[0]![3]).toBe("failed");
  });

  it("drops a citation to a source that wasn't retrieved", async () => {
    mocks.models.answer.model = modelWriting("Rent is monthly [1]. Pets are fine [7].");

    const all = await chunks(await post(body()));

    expect(textOf(all)).toBe("Rent is monthly [1]. Pets are fine.");
    expect(all.filter((c) => c.type === "data-citations").at(-1)).toMatchObject({
      data: { citations: [{ number: 1, source: 1, matched: false }] },
    });
  });

  it("on Try again, replaces the answers after the question", async () => {
    const askedAt = new Date("2026-10-28T10:00:00Z");
    mocks.saveUserMessage.mockResolvedValue(askedAt);

    await chunks(await post(body({ trigger: "regenerate-message" })));

    expect(mocks.deleteMessagesAfter).toHaveBeenCalledWith(alice, chatId, askedAt);
  });

  it("searches a follow-up that reads as standalone as asked, without a rewrite call", async () => {
    const followUp = "Can I keep a dog at the property?";
    mocks.listMessages.mockResolvedValue([
      ...followUpHistory,
      { id: questionId, role: "user", parts: [{ type: "text", text: followUp }] },
    ]);
    const doGenerate = vi.fn();
    mocks.models.rewrite.model = new MockLanguageModelV4({ doGenerate });

    await chunks(await post(body({ message: ask(followUp) })));

    expect(doGenerate).not.toHaveBeenCalled();
    expect(mocks.searchPassages).toHaveBeenCalledWith(expect.objectContaining({ query: followUp }));
  });

  it("rewrites a follow-up into a standalone query before searching", async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: "a0000000-0000-4000-8000-000000000001",
        role: "user",
        parts: [{ type: "text", text: "Can I keep a cat?" }],
      },
      {
        id: "a0000000-0000-4000-8000-000000000002",
        role: "assistant",
        parts: [{ type: "text", text: "Only with consent [1]." }],
      },
      { id: questionId, role: "user", parts: [{ type: "text", text: "And a dog?" }] },
    ]);
    mocks.models.rewrite.model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "Can I keep a dog at the property?" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 9, text: 9, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    await chunks(
      await post(
        body({
          message: { id: questionId, role: "user", parts: [{ type: "text", text: "And a dog?" }] },
        }),
      ),
    );

    expect(mocks.searchPassages).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Can I keep a dog at the property?" }),
    );
    expect(mocks.recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rewrite", model: "test/rewrite" }),
    );
  });
});
