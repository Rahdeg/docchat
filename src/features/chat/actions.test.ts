import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  refresh: vi.fn(),
  renameChat: vi.fn(),
  deleteChat: vi.fn(),
  setFeedback: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("./mutations", () => ({
  renameChat: mocks.renameChat,
  deleteChat: mocks.deleteChat,
  setFeedback: mocks.setFeedback,
}));

const { deleteChat, rateAnswer, renameChat } = await import("./actions");

const alice = "user_alice";
const chatId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const messageId = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: alice });
  mocks.renameChat.mockResolvedValue(true);
  mocks.deleteChat.mockResolvedValue(true);
  mocks.setFeedback.mockResolvedValue(true);
});

describe("renameChat", () => {
  it("rejects signed-out callers without writing", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    expect(await renameChat({ id: chatId, title: "Rent" })).toMatchObject({ ok: false });
    expect(mocks.renameChat).not.toHaveBeenCalled();
  });

  it("renames the caller's chat and refreshes the sidebar", async () => {
    expect(await renameChat({ id: chatId, title: "  Rent notice  " })).toEqual({
      ok: true,
      data: { id: chatId, title: "Rent notice" },
    });
    expect(mocks.renameChat).toHaveBeenCalledWith(alice, chatId, "Rent notice");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    const result = await renameChat({ id: chatId, title: "   " });

    expect(result).toMatchObject({ ok: false, fieldErrors: { title: ["Give the chat a name."] } });
  });

  it("says so when the chat isn't the caller's", async () => {
    mocks.renameChat.mockResolvedValue(false);

    expect(await renameChat({ id: chatId, title: "Mine now" })).toEqual({
      ok: false,
      error: "This chat doesn't exist.",
    });
  });
});

describe("deleteChat", () => {
  it("deletes only through the caller's id", async () => {
    expect(await deleteChat({ id: chatId })).toEqual({ ok: true, data: { id: chatId } });
    expect(mocks.deleteChat).toHaveBeenCalledWith(alice, chatId);
  });

  it("rejects an id that isn't a uuid", async () => {
    expect(await deleteChat({ id: "../all" })).toMatchObject({ ok: false });
    expect(mocks.deleteChat).not.toHaveBeenCalled();
  });
});

describe("rateAnswer", () => {
  it("stores a thumbs up or down, or clears it", async () => {
    await rateAnswer({ messageId, feedback: "down" });
    await rateAnswer({ messageId, feedback: null });

    expect(mocks.setFeedback.mock.calls).toEqual([
      [alice, messageId, "down"],
      [alice, messageId, null],
    ]);
  });

  it("rejects other values", async () => {
    // @ts-expect-error: not a feedback value
    expect(await rateAnswer({ messageId, feedback: "meh" })).toMatchObject({ ok: false });
  });
});
