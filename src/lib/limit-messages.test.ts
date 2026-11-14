import { describe, expect, it } from "vitest";

import { limitMessage, parseLimitBody, waitText, type LimitFailure } from "./limit-messages";

describe("limitMessage", () => {
  it.each<[LimitFailure, string]>([
    [
      { code: "DOCUMENT_LIMIT", max: 3 },
      "You've reached the free limit of 3 documents. Delete one to upload another.",
    ],
    [
      { code: "FILE_TOO_LARGE", maxMb: 10, sizeBytes: 14.2 * 1024 * 1024, fileName: "Lease.pdf" },
      "Lease.pdf is 14.2 MB. The free limit is 10 MB per file.",
    ],
    [
      { code: "TOO_MANY_PAGES", max: 50, pages: 120 },
      "This PDF has 120 pages. The free limit is 50.",
    ],
    [
      { code: "DUPLICATE_DOCUMENT", existingName: "Lease.pdf" },
      'You already have this file as "Lease.pdf".',
    ],
    [
      { code: "QUESTIONS_PER_MINUTE", max: 5, retryAfterSeconds: 39.2 },
      "You're asking quickly. Try again in 40 seconds.",
    ],
    [
      { code: "QUESTIONS_PER_DAY", max: 30 },
      "You've used today's 30 questions. They reset at midnight UTC.",
    ],
    [
      { code: "AGENT_RUNS_PER_DAY", max: 5 },
      "You've used today's 5 task requests. They reset at midnight UTC. You can still ask questions.",
    ],
    [
      { code: "GLOBAL_PAUSED" },
      "DocChat is very busy today, so new questions are paused until tomorrow. Your documents are safe.",
    ],
    [
      { code: "QUESTION_TOO_LONG", max: 500 },
      "Questions can be up to 500 characters. Try a shorter one.",
    ],
  ])("words %o", (failure, message) => {
    expect(limitMessage(failure)).toBe(message);
  });
});

describe("waitText", () => {
  it("rounds up, so the wait is never shorter than the real one", () => {
    expect(waitText(0.2)).toBe("1 second");
    expect(waitText(1)).toBe("1 second");
    expect(waitText(59.1)).toBe("60 seconds");
    expect(waitText(60)).toBe("1 minute");
    expect(waitText(61)).toBe("2 minutes");
  });
});

describe("parseLimitBody", () => {
  it("reads a route's limit refusal", () => {
    const limit = { code: "QUESTIONS_PER_MINUTE", max: 5, retryAfterSeconds: 40 };

    expect(parseLimitBody(JSON.stringify({ error: "x", limit }))).toEqual(limit);
  });

  it("is null for anything else", () => {
    expect(parseLimitBody("You need to be signed in.")).toBeNull();
    expect(parseLimitBody(JSON.stringify({ error: "x" }))).toBeNull();
    expect(parseLimitBody(JSON.stringify({ limit: { code: "MADE_UP" } }))).toBeNull();
  });
});
