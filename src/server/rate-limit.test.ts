import { describe, expect, it } from "vitest";

import { limitsFrom } from "@/lib/limits";

import { mcpSteps, questionSteps, windowFailure, windowFor } from "./rate-limit";

// The limiter's plan for each request, without a database: which counts a request meets, in
// which order, and who skips them. rate-limit.integration.test.ts runs them against Postgres.

const limits = limitsFrom({ UNLIMITED_USER_IDS: "user_demo, user_other" });
const alice = "user_alice";
const demo = "user_demo";

const kinds = (steps: ReturnType<typeof questionSteps>) =>
  steps.map((step) =>
    step.type === "window" ? `window:${step.bucket}` : `${step.type}:${step.subject}:${step.kind}`,
  );

describe("questionSteps", () => {
  it("checks the user's minute and day, then the global breaker last", () => {
    expect(kinds(questionSteps(alice, { agent: false }, limits))).toEqual([
      "window:question",
      "daily:user_alice:question",
      "daily:*:question",
    ]);
  });

  it("adds the day's task requests for a task request", () => {
    expect(kinds(questionSteps(alice, { agent: true }, limits))).toEqual([
      "window:question",
      "daily:user_alice:question",
      "daily:user_alice:agent-run",
      "daily:*:question",
    ]);
  });

  it("carries the numbers each refusal needs", () => {
    const [, day, agent, global] = questionSteps(alice, { agent: true }, limits);

    expect(day).toMatchObject({ max: 30, failure: { code: "QUESTIONS_PER_DAY", max: 30 } });
    expect(agent).toMatchObject({ max: 5, failure: { code: "AGENT_RUNS_PER_DAY", max: 5 } });
    expect(global).toMatchObject({ max: 2000, failure: { code: "GLOBAL_PAUSED" } });
  });

  it("lets unlimited users skip their own limits, but not the global breaker", () => {
    expect(kinds(questionSteps(demo, { agent: true }, limits))).toEqual(["daily:*:question"]);
    expect(kinds(questionSteps("user_other", { agent: false }, limits))).toEqual([
      "daily:*:question",
    ]);
  });

  it("follows the env overrides", () => {
    const custom = limitsFrom({ QUESTIONS_PER_DAY: "12", GLOBAL_QUESTIONS_PER_DAY: "40" });
    const [, day, global] = questionSteps(alice, { agent: false }, custom);

    expect(day).toMatchObject({ max: 12 });
    expect(global).toMatchObject({ max: 40 });
  });
});

describe("mcpSteps", () => {
  it("counts every tool call against the minute's MCP calls", () => {
    expect(kinds(mcpSteps(alice, { search: false }, limits))).toEqual(["window:mcp"]);
  });

  it("counts a search against the minute's searches and the day's MCP searches, and stops while the breaker is tripped", () => {
    const steps = mcpSteps(alice, { search: true }, limits);

    expect(kinds(steps)).toEqual([
      "window:mcp",
      "window:search",
      "daily:user_alice:mcp-search",
      // Checked, not counted: a search costs an embedding, not a chat call.
      "open:*:question",
    ]);
    expect(steps[2]).toMatchObject({ max: 200 });
    expect(steps[3]).toMatchObject({ max: 2000, failure: { code: "GLOBAL_PAUSED" } });
  });

  it("lets unlimited users skip their own limits, but not the global breaker", () => {
    expect(kinds(mcpSteps(demo, { search: false }, limits))).toEqual([]);
    expect(kinds(mcpSteps(demo, { search: true }, limits))).toEqual(["open:*:question"]);
  });
});

describe("windows", () => {
  it("keeps the agreed numbers", () => {
    expect(windowFor("question", limits)).toEqual({ max: 5, windowSeconds: 60 });
    expect(windowFor("mcp", limits)).toEqual({ max: 60, windowSeconds: 60 });
    expect(windowFor("search", limits)).toEqual({ max: 30, windowSeconds: 60 });
    expect(windowFor("upload", limits)).toEqual({ max: 20, windowSeconds: 3600 });
    expect(windowFor("reindex", limits)).toEqual({ max: 10, windowSeconds: 3600 });
  });

  it("words a full question window as the per-minute limit, with the real wait", () => {
    expect(windowFailure("question", 40, limits)).toEqual({
      code: "QUESTIONS_PER_MINUTE",
      max: 5,
      retryAfterSeconds: 40,
    });
    expect(windowFailure("upload", 600, limits)).toEqual({
      code: "RATE_LIMITED",
      bucket: "upload",
      max: 20,
      retryAfterSeconds: 600,
    });
  });
});
