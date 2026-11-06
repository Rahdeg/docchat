import { describe, expect, it } from "vitest";

import { LONGEST_WINDOW_SECONDS, RATE_LIMITS, rateLimitMessage } from "./rate-limits";

describe("rate limits", () => {
  it("keeps the agreed numbers", () => {
    expect(RATE_LIMITS).toEqual({
      mcp: { max: 60, windowSeconds: 60 },
      search: { max: 30, windowSeconds: 60 },
      upload: { max: 20, windowSeconds: 3600 },
    });
    expect(LONGEST_WINDOW_SECONDS).toBe(3600);
  });

  it("says when to try again", () => {
    expect(rateLimitMessage("search", 0.2)).toBe(
      "That's a lot of searches in a minute. Try again in 1 second.",
    );
    expect(rateLimitMessage("search", 42)).toContain("42 seconds");
    expect(rateLimitMessage("upload", 61)).toBe(
      "You've uploaded 20 files in the last hour. You can upload more in 2 minutes.",
    );
    expect(rateLimitMessage("mcp", 60)).toContain("1 minute.");
  });
});
