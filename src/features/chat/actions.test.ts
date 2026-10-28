import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  searchPassages: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/server/ai/retrieve", () => ({ searchPassages: mocks.searchPassages }));
vi.mock("@/server/ai/models", () => ({ MIN_SIMILARITY: 0.25 }));

const { findPassages } = await import("./actions");

const alice = "user_alice";
const docId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const passage = {
  chunkId: "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
  documentId: docId,
  name: "Lease.pdf",
  mimeType: "application/pdf",
  hasFile: true,
  page: 3,
  content: "The rent is 950 pounds a month.",
  startOffset: 0,
  endOffset: 31,
  similarity: 0.71,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: alice });
  mocks.searchPassages.mockResolvedValue([passage]);
});

describe("findPassages", () => {
  it("rejects signed-out callers without searching", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    expect(await findPassages({ query: "What is the rent?" })).toEqual({
      ok: false,
      error: "You need to be signed in.",
    });
    expect(mocks.searchPassages).not.toHaveBeenCalled();
  });

  it("searches the caller's own documents with the similarity floor", async () => {
    const result = await findPassages({ query: "  What is the rent?  " });

    expect(result).toEqual({ ok: true, data: [passage] });
    expect(mocks.searchPassages).toHaveBeenCalledWith({
      userId: alice,
      query: "What is the rent?",
      documentIds: undefined,
      limit: 5,
      minSimilarity: 0.25,
    });
  });

  it("passes chosen documents through", async () => {
    await findPassages({ query: "What is the rent?", documentIds: [docId] });

    expect(mocks.searchPassages).toHaveBeenCalledWith(
      expect.objectContaining({ userId: alice, documentIds: [docId] }),
    );
  });

  it.each([
    ["too short", "hi"],
    ["too short once trimmed", "  ab   "],
    ["too long", "a".repeat(501)],
  ])("rejects a query that's %s", async (_case, query) => {
    const result = await findPassages({ query });

    expect(result).toMatchObject({ ok: false, fieldErrors: { query: expect.any(Array) } });
    expect(mocks.searchPassages).not.toHaveBeenCalled();
  });

  it("accepts queries of exactly 3 and 500 characters", async () => {
    expect(await findPassages({ query: "abc" })).toMatchObject({ ok: true });
    expect(await findPassages({ query: "a".repeat(500) })).toMatchObject({ ok: true });
  });

  it.each([
    ["isn't a UUID", ["not-a-uuid"]],
    ["is empty", []],
    ["has more than 20 documents", Array.from({ length: 21 }, () => docId)],
  ])("rejects a document list that %s", async (_case, documentIds) => {
    const result = await findPassages({ query: "What is the rent?", documentIds });

    expect(result).toMatchObject({ ok: false, fieldErrors: { documentIds: expect.any(Array) } });
    expect(mocks.searchPassages).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.searchPassages.mockRejectedValue(new Error("gateway down"));

    expect(await findPassages({ query: "What is the rent?" })).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
  });
});
