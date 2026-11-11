import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readResultFiles, type ResultFile } from "./eval-summary-lib";
import { evalsSection, formatReadme, readmeFile, replaceSection, testsSection } from "./readme-lib";

const run = (name: string, data: Record<string, unknown>): ResultFile => ({
  name,
  data: { only: null, complete: true, ...data },
});

const files: ResultFile[] = [
  run("retrieval-2026-10-31.json", {
    date: "2026-10-31T13:48:36.237Z",
    model: "google/gemini-embedding-001",
    metrics: { questions: 14, hitAt1: 0.9286, hitAt5: 1 },
  }),
  run("answers-2026-11-01.json", {
    date: "2026-11-01T08:03:00.779Z",
    models: { answer: "google/gemini-3.6-flash", judge: "google/gemma-4-26b-a4b-it" },
    metrics: {
      citationAccuracy: 0.9286,
      grounding: 0.92,
      honesty: 1,
      counts: { answerable: 14, mustDecline: 6 },
    },
  }),
  run("agent-2026-11-03.json", {
    date: "2026-11-03T08:12:03.615Z",
    models: { answer: "google/gemini-3.6-flash" },
    metrics: { recall: 1, inventedDates: 0, counts: { expected: 15 } },
  }),
  run("injection-2026-11-06.json", {
    date: "2026-11-06T19:28:25.782Z",
    models: { answer: "google/gemini-3.6-flash" },
    results: [{ check: { passed: true }, error: null }, { check: { passed: false } }],
  }),
];

describe("evalsSection", () => {
  it("shows each eval's latest full run with its date and model", () => {
    const table = evalsSection(files);
    expect(table).toContain(
      "| Retrieval | Search ranks the passage that answers the question first (hit@1) or in the top 5 | hit@1 93%, hit@5 100% over 14 questions | 31 Oct 2026 | `google/gemini-embedding-001` |",
    );
    expect(table).toContain(
      "right page cited 93% of 14, grounding 92%, “your documents don’t say” 6 of 6 | 1 Nov 2026 | `google/gemini-3.6-flash`, judge `google/gemma-4-26b-a4b-it` |",
    );
    expect(table).toContain("| 15 of 15 found, 0 invented dates | 3 Nov 2026 |");
    expect(table).toContain("| 1 of 2 attacks ignored | 6 Nov 2026 |");
  });

  it("leaves out an eval with no full run and a metric the run lacks", () => {
    const partial = [
      run("retrieval-2026-10-31.json", {
        date: "2026-10-31T13:48:36.237Z",
        metrics: { questions: 14, hitAt5: 1 },
      }),
      run("answers-2026-11-02-only.json", {
        date: "2026-11-02T08:00:00.000Z",
        only: ["company-car"],
        metrics: { citationAccuracy: 1, counts: { answerable: 1 } },
      }),
    ];
    const table = evalsSection(partial);
    expect(table).toContain("| hit@5 100% over 14 questions | 31 Oct 2026 |  |");
    expect(table).not.toContain("hit@1 ");
    expect(table).not.toContain("Answers");
  });

  it("says so when there are no runs", () => {
    expect(evalsSection([])).toBe("_No full eval runs are saved yet._");
  });
});

describe("testsSection", () => {
  it("dates the counts", () => {
    const text = testsSection({
      unitTests: 461,
      unitFiles: 60,
      integrationFiles: 1,
      e2eTests: 55,
      e2eFiles: 8,
      countedAt: "2026-11-11",
    });
    expect(text).toContain("Counted on 11 Nov 2026");
    expect(text).toContain("**461 Vitest tests** in 60 files");
    expect(text).toContain("**1 integration test file**");
  });
});

describe("replaceSection", () => {
  it("replaces only what sits between the markers", () => {
    const readme = "a\n<!-- evals:start -->\nold\n<!-- evals:end -->\nb\n";
    expect(replaceSection(readme, "evals", "new")).toBe(
      "a\n<!-- evals:start -->\n\nnew\n\n<!-- evals:end -->\nb\n",
    );
  });

  it("fails without markers", () => {
    expect(() => replaceSection("no markers", "tests", "x")).toThrow("tests:start");
  });
});

describe("README.md", () => {
  it("shows the eval table for the saved results (run `pnpm readme:evals` after new results)", async () => {
    const readme = readFileSync(readmeFile, "utf8");
    const expected = await formatReadme(
      replaceSection(readme, "evals", evalsSection(readResultFiles())),
    );
    expect(readme).toBe(expected);
  });
});
