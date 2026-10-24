import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ActionError, authedAction } from "./action";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

const schema = z.object({ title: z.string().trim().min(1, "Title is required") });

describe("authedAction", () => {
  const handler = vi.fn(async (input: { title: string }, ctx: { userId: string }) => ({
    title: input.title,
    userId: ctx.userId,
  }));
  const action = authedAction(schema, handler);

  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ userId: "user_123" });
  });

  it("rejects signed-out callers before validating or running the handler", async () => {
    auth.mockResolvedValue({ userId: null });
    const parse = vi.spyOn(schema, "safeParse");

    const result = await action({ title: "" });

    expect(result).toEqual({ ok: false, error: "You need to be signed in." });
    expect(parse).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("returns field errors for invalid input without running the handler", async () => {
    const result = await action({ title: "   " });

    expect(result).toMatchObject({ ok: false, fieldErrors: { title: ["Title is required"] } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects input that isn't the expected shape", async () => {
    const result = await action("not an object" as unknown as { title: string });

    expect(result.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes parsed input and the userId to the handler", async () => {
    const result = await action({ title: "  Book leave  " });

    expect(result).toEqual({ ok: true, data: { title: "Book leave", userId: "user_123" } });
  });

  it("hides unexpected handler errors behind a generic message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = authedAction(schema, async () => {
      throw new Error("connection refused");
    });

    expect(await failing({ title: "x" })).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    consoleError.mockRestore();
  });

  it("returns an ActionError's message to the caller", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const refusing = authedAction(schema, async () => {
      throw new ActionError("That document was already removed.");
    });

    expect(await refusing({ title: "x" })).toEqual({
      ok: false,
      error: "That document was already removed.",
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("lets Next's redirect() through", async () => {
    const redirecting = authedAction(schema, async () => redirect("/library"));

    await expect(redirecting({ title: "x" })).rejects.toThrow("NEXT_REDIRECT");
  });
});
