import { afterEach, describe, expect, it, vi } from "vitest";

import { errorKind, log } from "./log";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("log", () => {
  it("writes one JSON line with the event and its fields", () => {
    vi.stubEnv("LOG_IN_TESTS", "1");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("document.indexed", {
      userId: "user_a",
      documentId: "d1",
      pages: 6,
      chunks: 16,
      durationMs: 812,
      model: "fake/hashed-bag-of-words",
    });
    expect(JSON.parse(out.mock.calls[0]![0] as string)).toMatchObject({
      level: "info",
      event: "document.indexed",
      userId: "user_a",
      chunks: 16,
      time: expect.any(String),
    });
  });

  it("writes warnings to stderr", () => {
    vi.stubEnv("LOG_IN_TESTS", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log("quota.hit", { userId: "user_a", limit: "daily" }, "warn");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is quiet under Vitest by default", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("agent.cancelled", { userId: "user_a", chatId: "c", proposed: 3 });
    expect(out).not.toHaveBeenCalled();
  });
});

describe("errorKind", () => {
  it("names the error without its message", () => {
    const error = Object.assign(new Error("The rent is 1,150 pounds"), { statusCode: 429 });
    expect(errorKind(error)).toBe("Error:429");
    expect(errorKind(Object.assign(new TypeError("x"), { code: "ECONNREFUSED" }))).toBe(
      "TypeError:ECONNREFUSED",
    );
    expect(errorKind(Object.assign(new Error("x"), { code: "not a code: a@b.co" }))).toBe("Error");
    expect(errorKind("boom")).toBe("string");
  });
});
