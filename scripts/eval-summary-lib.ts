// Builds src/content/eval-summary.json from the saved eval runs (tests/evals/results/). Pure, so
// it's unit-tested (eval-summary.test.ts), apart from readResultFiles.
//
// Rules:
// - Each eval's newest full run counts, by its `date`. Partial runs (--only, or a file named
//   *-only.json) and unfinished ones (complete: false) are skipped.
// - A metric that run doesn't have is left out. It's never taken from an older run: that would
//   be a stale number.
// - A run file that doesn't parse is skipped with a warning, so it can't hide a good run.
import { readdirSync, readFileSync } from "node:fs";

import { z } from "zod";

import { evalSummarySchema, type EvalSummary } from "../src/content/eval-summary-schema";

export type ResultFile = { name: string; data: unknown };

const evalNames = ["answers", "agent", "injection", "retrieval"] as const;
type EvalName = (typeof evalNames)[number];

// What every run file has: when it ran and whether it was a full run.
const runSchema = z.object({
  date: z.iso.datetime(),
  only: z.array(z.string()).nullish(),
  complete: z.boolean().optional(),
});

const maybeNumber = z.number().nullish();

const answersSchema = z.object({
  metrics: z.object({
    citationAccuracy: maybeNumber,
    honesty: maybeNumber,
    grounding: maybeNumber,
    counts: z.object({ answerable: maybeNumber, mustDecline: maybeNumber }).partial().optional(),
  }),
});

const agentSchema = z.object({
  metrics: z.object({
    recall: maybeNumber,
    inventedDates: maybeNumber,
    counts: z.object({ expected: maybeNumber }).partial().optional(),
  }),
});

const injectionSchema = z.object({
  results: z
    .array(
      z.object({
        check: z.object({ passed: z.boolean() }).nullish(),
        error: z.unknown().optional(),
      }),
    )
    .optional(),
});

const retrievalSchema = z.object({
  metrics: z.object({ questions: maybeNumber, hitAt1: maybeNumber, hitAt5: maybeNumber }),
});

export function evalNameOf(fileName: string): EvalName | null {
  const match = /^([a-z]+)-\d{4}-\d{2}-\d{2}(-only)?\.json$/.exec(fileName);
  const name = match?.[1];
  if (!name || match[2]) return null;
  return (evalNames as readonly string[]).includes(name) ? (name as EvalName) : null;
}

type Run = { date: string; data: unknown };

// The newest full run of each eval.
export function latestFullRuns(
  files: readonly ResultFile[],
  warn: (message: string) => void = () => {},
): Partial<Record<EvalName, Run>> {
  const latest: Partial<Record<EvalName, Run>> = {};
  for (const file of files) {
    const name = evalNameOf(file.name);
    if (!name) continue;
    const run = runSchema.safeParse(file.data);
    if (!run.success) {
      warn(`${file.name}: not a saved eval run, skipped`);
      continue;
    }
    if ((run.data.only && run.data.only.length > 0) || run.data.complete === false) continue;
    const current = latest[name];
    if (!current || run.data.date > current.date) {
      latest[name] = { date: run.data.date, data: file.data };
    }
  }
  return latest;
}

// A share as a count of N questions, when it is one (0.75 of 4 → 3). Null if it isn't whole.
function countFrom(share: number, total: number): number | null {
  const passed = Math.round(share * total);
  return Math.abs(passed / total - share) < 0.005 ? passed : null;
}

function isShare(value: number | null | undefined): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function summarize(
  files: readonly ResultFile[],
  warn: (message: string) => void = () => {},
): EvalSummary {
  const runs = latestFullRuns(files, warn);
  const summary: EvalSummary = {};
  const parse = <T>(name: EvalName, schema: z.ZodType<T>): (T & { measuredAt: string }) | null => {
    const run = runs[name];
    if (!run) return null;
    const parsed = schema.safeParse(run.data);
    if (!parsed.success) {
      warn(`${name} (${run.date}): unexpected shape, its metrics are hidden`);
      return null;
    }
    return { ...parsed.data, measuredAt: run.date.slice(0, 10) };
  };

  const answers = parse("answers", answersSchema);
  if (answers) {
    const { citationAccuracy, honesty, grounding, counts } = answers.metrics;
    const answerable = counts?.answerable;
    const mustDecline = counts?.mustDecline;
    const honest =
      isShare(honesty) && isCount(mustDecline) ? countFrom(honesty, mustDecline) : null;
    summary.answers = {
      measuredAt: answers.measuredAt,
      ...(isShare(citationAccuracy) && isCount(answerable)
        ? { citationAccuracy: { share: citationAccuracy, total: answerable } }
        : {}),
      ...(honest !== null && isCount(mustDecline)
        ? { honesty: { passed: honest, total: mustDecline } }
        : {}),
      ...(isShare(grounding) ? { grounding } : {}),
    };
  }

  const agent = parse("agent", agentSchema);
  if (agent) {
    const { recall, inventedDates, counts } = agent.metrics;
    const expected = counts?.expected;
    const found = isShare(recall) && isCount(expected) ? countFrom(recall, expected) : null;
    summary.agent = {
      measuredAt: agent.measuredAt,
      ...(found !== null &&
      isCount(expected) &&
      typeof inventedDates === "number" &&
      Number.isInteger(inventedDates) &&
      inventedDates >= 0
        ? { deadlines: { passed: found, total: expected, inventedDates } }
        : {}),
    };
  }

  const injection = parse("injection", injectionSchema);
  if (injection) {
    const results = injection.results ?? [];
    summary.injection = {
      measuredAt: injection.measuredAt,
      ...(results.length > 0
        ? {
            attacks: {
              // A case that errored never got checked, so it doesn't count as ignored.
              passed: results.filter((r) => !r.error && r.check?.passed === true).length,
              total: results.length,
            },
          }
        : {}),
    };
  }

  const retrieval = parse("retrieval", retrievalSchema);
  if (retrieval && isCount(retrieval.metrics.questions)) {
    const { questions, hitAt1, hitAt5 } = retrieval.metrics;
    summary.retrieval = {
      measuredAt: retrieval.measuredAt,
      questions,
      ...(isShare(hitAt1) ? { hitAt1 } : {}),
      ...(isShare(hitAt5) ? { hitAt5 } : {}),
    };
  }

  return evalSummarySchema.parse(summary);
}

// The file as written: stable key order, two-space indent, trailing newline (Prettier's JSON).
export function serialize(summary: EvalSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export const resultsDir = new URL("../tests/evals/results/", import.meta.url);
export const summaryFile = new URL("../src/content/eval-summary.json", import.meta.url);

export function readResultFiles(dir: URL = resultsDir): ResultFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      data: JSON.parse(readFileSync(new URL(name, dir), "utf8")) as unknown,
    }));
}
