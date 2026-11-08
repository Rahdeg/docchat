import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatMeasuredAt, formatShare } from "../src/content/eval-summary";
import {
  evalNameOf,
  latestFullRuns,
  readResultFiles,
  serialize,
  summarize,
  summaryFile,
  type ResultFile,
} from "./eval-summary-lib";

function answers(date: string, metrics: Record<string, unknown>, extra = {}): ResultFile {
  return {
    name: `answers-${date.slice(0, 10)}.json`,
    data: { date, only: null, complete: true, metrics, ...extra },
  };
}

const fullAnswers = {
  citationAccuracy: 0.9286,
  honesty: 1,
  grounding: 0.92,
  counts: { answerable: 14, mustDecline: 6 },
};

describe("evalNameOf", () => {
  it("reads the eval from a full run's file name", () => {
    expect(evalNameOf("answers-2026-11-01.json")).toBe("answers");
    expect(evalNameOf("injection-2026-11-06.json")).toBe("injection");
  });

  it("skips --only files and anything else", () => {
    expect(evalNameOf("answers-2026-10-31-only.json")).toBeNull();
    expect(evalNameOf("notes.json")).toBeNull();
    expect(evalNameOf("speed-2026-11-01.json")).toBeNull();
  });
});

describe("latestFullRuns", () => {
  it("takes the newest run by its date, not its file order", () => {
    const runs = latestFullRuns([
      answers("2026-11-01T08:00:00.000Z", fullAnswers),
      answers("2026-10-28T08:00:00.000Z", fullAnswers),
    ]);
    expect(runs.answers?.date).toBe("2026-11-01T08:00:00.000Z");
  });

  it("ignores partial and unfinished runs", () => {
    const runs = latestFullRuns([
      answers("2026-10-28T08:00:00.000Z", fullAnswers),
      answers("2026-11-02T08:00:00.000Z", fullAnswers, { only: ["rent-amount"] }),
      answers("2026-11-03T08:00:00.000Z", fullAnswers, { complete: false }),
    ]);
    expect(runs.answers?.date).toBe("2026-10-28T08:00:00.000Z");
  });

  it("counts a run with no complete flag (retrieval runs) as complete", () => {
    const runs = latestFullRuns([
      {
        name: "retrieval-2026-10-31.json",
        data: { date: "2026-10-31T13:48:36.237Z", metrics: {} },
      },
    ]);
    expect(runs.retrieval?.date).toBe("2026-10-31T13:48:36.237Z");
  });

  it("warns about a file that isn't a run and skips it", () => {
    const warnings: string[] = [];
    const runs = latestFullRuns([{ name: "agent-2026-11-03.json", data: { oops: 1 } }], (m) =>
      warnings.push(m),
    );
    expect(runs.agent).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/agent-2026-11-03\.json/)]);
  });
});

describe("summarize", () => {
  it("reports each metric of the latest run with its date", () => {
    expect(summarize([answers("2026-11-01T08:03:00.779Z", fullAnswers)])).toEqual({
      answers: {
        measuredAt: "2026-11-01",
        citationAccuracy: { share: 0.9286, total: 14 },
        honesty: { passed: 6, total: 6 },
        grounding: 0.92,
      },
    });
  });

  it("leaves out an eval with no full run", () => {
    expect(summarize([])).toEqual({});
  });

  it("hides a metric the latest run lacks", () => {
    const summary = summarize([
      answers("2026-11-01T08:00:00.000Z", { ...fullAnswers, citationAccuracy: null }),
    ]);
    expect(summary.answers).not.toHaveProperty("citationAccuracy");
    expect(summary.answers?.honesty).toEqual({ passed: 6, total: 6 });
  });

  it("never falls back to an older run's number (stale)", () => {
    const summary = summarize([
      answers("2026-10-28T08:00:00.000Z", { ...fullAnswers, honesty: 1 }),
      answers("2026-11-01T08:00:00.000Z", {
        citationAccuracy: 0.9,
        counts: { answerable: 10 },
      }),
    ]);
    expect(summary.answers).toEqual({
      measuredAt: "2026-11-01",
      citationAccuracy: { share: 0.9, total: 10 },
    });
  });

  it("hides honesty when it isn't a whole count of the questions", () => {
    const summary = summarize([
      answers("2026-11-01T08:00:00.000Z", {
        ...fullAnswers,
        honesty: 0.4,
        counts: { mustDecline: 6 },
      }),
    ]);
    expect(summary.answers).not.toHaveProperty("honesty");
  });

  it("hides the metrics of a run with an unexpected shape", () => {
    const warnings: string[] = [];
    const summary = summarize(
      [{ name: "agent-2026-11-03.json", data: { date: "2026-11-03T08:00:00.000Z", metrics: 3 } }],
      (m) => warnings.push(m),
    );
    expect(summary.agent).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("counts agent deadlines and keeps the invented dates", () => {
    const summary = summarize([
      {
        name: "agent-2026-11-03.json",
        data: {
          date: "2026-11-03T08:12:03.615Z",
          only: null,
          complete: true,
          metrics: { recall: 0.8, inventedDates: 1, counts: { expected: 15 } },
        },
      },
    ]);
    expect(summary.agent).toEqual({
      measuredAt: "2026-11-03",
      deadlines: { passed: 12, total: 15, inventedDates: 1 },
    });
  });

  it("hides agent deadlines when invented dates weren't measured", () => {
    const summary = summarize([
      {
        name: "agent-2026-11-03.json",
        data: {
          date: "2026-11-03T08:12:03.615Z",
          metrics: { recall: 1, counts: { expected: 15 } },
        },
      },
    ]);
    expect(summary.agent).toEqual({ measuredAt: "2026-11-03" });
  });

  it("counts injection cases that passed, and errors as not passed", () => {
    const summary = summarize([
      {
        name: "injection-2026-11-06.json",
        data: {
          date: "2026-11-06T19:28:25.782Z",
          only: null,
          complete: true,
          results: [
            { check: { passed: true }, error: null },
            { check: { passed: false }, error: null },
            { check: null, error: "quota" },
          ],
        },
      },
    ]);
    expect(summary.injection?.attacks).toEqual({ passed: 1, total: 3 });
  });

  it("hides injection when the run has no cases", () => {
    const summary = summarize([
      {
        name: "injection-2026-11-06.json",
        data: { date: "2026-11-06T19:28:25.782Z", results: [] },
      },
    ]);
    expect(summary.injection).toEqual({ measuredAt: "2026-11-06" });
  });
});

describe("eval-summary.json", () => {
  it("matches the saved results (run pnpm eval:summary and commit it)", () => {
    const committed = readFileSync(summaryFile, "utf8");
    expect(committed).toBe(serialize(summarize(readResultFiles())));
  });
});

describe("formatting", () => {
  it("formats the run date and shares", () => {
    expect(formatMeasuredAt("2026-11-01")).toBe("1 Nov 2026");
    expect(formatShare(0.9286)).toBe("93%");
    expect(formatShare(1)).toBe("100%");
  });
});
