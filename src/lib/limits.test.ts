import { describe, expect, it } from "vitest";

import { documentLimitFor, isUnlimited, limitsFrom } from "./limits";

describe("limitsFrom", () => {
  it("has the launch defaults", () => {
    expect(limitsFrom({})).toMatchObject({
      maxDocuments: 3,
      maxFileMb: 10,
      maxFileBytes: 10 * 1024 * 1024,
      maxPages: 50,
      questionsPerMinute: 5,
      questionsPerDay: 30,
      agentRunsPerDay: 5,
      maxQuestionChars: 500,
      maxOutputTokens: 1500,
      agentMaxOutputTokens: 4000,
      historyMessages: 6,
      globalQuestionsPerDay: 2000,
      mcpSearchesPerDay: 200,
      reindexPerHour: 10,
      mcpCallsPerMinute: 60,
      searchesPerMinute: 30,
      uploadsPerHour: 20,
    });
    expect(limitsFrom({}).unlimitedUserIds.size).toBe(0);
  });

  it("reads each override from its env var, as the strings env hands over", () => {
    const limits = limitsFrom({
      MAX_DOCUMENTS_PER_USER: "5",
      MAX_FILE_MB: "4",
      QUESTIONS_PER_DAY: "100",
      MAX_OUTPUT_TOKENS: "900",
    });

    expect(limits.maxDocuments).toBe(5);
    expect(limits.maxFileBytes).toBe(4 * 1024 * 1024);
    expect(limits.questionsPerDay).toBe(100);
    expect(limits.maxOutputTokens).toBe(900);
  });

  it("refuses a limit that isn't a positive whole number", () => {
    expect(() => limitsFrom({ QUESTIONS_PER_DAY: "0" })).toThrow();
    expect(() => limitsFrom({ MAX_DOCUMENTS_PER_USER: "lots" })).toThrow();
    expect(() => limitsFrom({ MAX_FILE_MB: "2.5" })).toThrow();
  });
});

describe("the unlimited list", () => {
  const limits = limitsFrom({ UNLIMITED_USER_IDS: " user_demo ,user_other,, " });

  it("is comma-separated, ignoring spaces and empty entries", () => {
    expect([...limits.unlimitedUserIds]).toEqual(["user_demo", "user_other"]);
  });

  it("lifts the document limit only for the listed users", () => {
    expect(isUnlimited("user_demo", limits)).toBe(true);
    expect(isUnlimited("user_alice", limits)).toBe(false);
    expect(documentLimitFor("user_demo", limits)).toBeNull();
    expect(documentLimitFor("user_alice", limits)).toBe(3);
  });
});
