// Agent eval: asks each scenario in agent.json as a task request (runAgent: search, then propose)
// and scores the proposal the approval card would show. Nothing is approved or saved. Prints:
//
// - recall: expected tasks found (key words plus the clause or section they come from)
// - precision: proposed tasks the document asks for (expected or allowed); the rest are invented
// - valid sources: proposed tasks whose quote was found in one of the run's passages
// - invented dates: dates the model gave that no passage or the question states or counts from
//   (must be 0 on the card: the server drops them, which "shown" checks)
// - forbidden: tasks from the instruction planted in welcome-letter.pdf (must be 0)
// - dates right: expected tasks with a stated date that got it
//
// Saves the run to tests/evals/results/agent-<date>.json (agent-<date>-only.json with --only).
//
// Run: pnpm eval:agent. Not in CI: each scenario is up to five chat model calls (usually two or
// three), within the Gemini free tier's 20 a day. A run the daily quota stops is saved and
// continues where it left off when run again (--fresh starts over). --only=id,id runs just those
// scenarios. Uses DATABASE_URL (your Neon dev branch) and only touches the eval user's rows.
import "../../scripts/lib/load-env";

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";

import type { CheckedTask, ProposeTasksInput } from "@/features/chat/agent-parts";
import { AGENT_MAX_STEPS, runAgent } from "@/server/ai/agent";
import { isDailyQuotaError, sleep } from "@/server/ai/call-model";
import { chatConfig, EMBEDDING_MODEL, MIN_SIMILARITY } from "@/server/ai/models";
import { db } from "@/server/db";
import { document } from "@/server/db/schema";

import { assertDevelopment } from "../../scripts/lib/assert-development";
import {
  loadAgentCases,
  onlyScenarios,
  scoreScenario,
  share,
  summarize,
  type ScenarioScore,
} from "./agent-metrics";
import { indexFixtures } from "./index-fixtures";
import { evalsDir } from "./retrieval-cases";

const EVAL_USER_ID = "eval_agent";
// Between scenarios: under the free tier's per-minute limit.
const SCENARIO_GAP_MS = 8_000;

type ScenarioResult = {
  id: string;
  question: string;
  run: {
    steps: number;
    text: string;
    // Passages read, with the text of those the tasks point at.
    passages: { name: string; page: number | null; content: string }[];
    proposed: ProposeTasksInput | null;
    tasks: CheckedTask[];
  } | null;
  score: ScenarioScore | null;
  error: string | null;
};

type Run = {
  date: string;
  git: { sha: string; dirty: boolean };
  models: { answer: string; embedding: string };
  minSimilarity: number;
  maxSteps: number;
  only: string[] | null;
  complete: boolean;
  metrics: ReturnType<typeof summarize> | null;
  results: ScenarioResult[];
};

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

class QuotaUsedUp extends Error {}

async function main() {
  assertDevelopment(process.env.NODE_ENV);
  const fresh = process.argv.includes("--fresh");
  const cases = loadAgentCases();
  const only = onlyScenarios(process.argv, cases);
  const startedAt = new Date();
  const resultsDir = new URL("results/", evalsDir);
  mkdirSync(resultsDir, { recursive: true });
  const suffix = only ? "-only" : "";
  const file = new URL(`agent-${startedAt.toISOString().slice(0, 10)}${suffix}.json`, resultsDir);
  const models = { answer: chatConfig.models.answer.id, embedding: EMBEDDING_MODEL };

  // Continue an unfinished run of today's with the same models (and the same --only).
  let previous: Run | null = null;
  if (!fresh && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Run;
    const same =
      JSON.stringify(saved.models) === JSON.stringify(models) &&
      JSON.stringify(saved.only ?? null) === JSON.stringify(only ? [...only] : null);
    if (!saved.complete && same) previous = saved;
  }
  const scenarios = cases.scenarios.filter((s) => !only || only.has(s.id));
  const results: ScenarioResult[] = scenarios.map(
    (s) =>
      previous?.results.find((r) => r.id === s.id && r.run) ?? {
        id: s.id,
        question: s.question,
        run: null,
        score: null,
        error: null,
      },
  );

  const gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const dirty =
    execSync("git status --porcelain -- . ':!tests/evals/results'", { encoding: "utf8" }).trim()
      .length > 0;
  const run: Run = {
    date: previous?.date ?? startedAt.toISOString(),
    git: { sha: gitSha, dirty },
    models,
    minSimilarity: MIN_SIMILARITY,
    maxSteps: AGENT_MAX_STEPS,
    only: only ? [...only] : null,
    complete: false,
    metrics: null,
    results,
  };
  const save = () => writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);

  // Index once; a resumed or --only run reuses the indexed fixtures.
  const ready = await db
    .select({ id: document.id, name: document.name })
    .from(document)
    .where(and(eq(document.userId, EVAL_USER_ID), eq(document.status, "ready")));
  let documents = ready;
  if ((!previous && !only) || ready.length !== cases.fixtures.length) {
    console.log(`Indexing ${cases.fixtures.length} fixture document(s) for ${EVAL_USER_ID}…`);
    await indexFixtures(EVAL_USER_ID, cases.fixtures);
    documents = await db
      .select({ id: document.id, name: document.name })
      .from(document)
      .where(eq(document.userId, EVAL_USER_ID));
  }
  if (previous) {
    console.log(`Continuing ${previous.date}: ${results.filter((r) => r.run).length} done.`);
  }

  console.log(`Proposing with ${models.answer}, at most ${AGENT_MAX_STEPS} calls a scenario`);
  try {
    for (const result of results) {
      if (result.run) continue;
      const scenario = scenarios.find((s) => s.id === result.id)!;
      process.stdout.write(`  ${result.id}… `);
      try {
        const agent = await runAgent({
          userId: EVAL_USER_ID,
          question: scenario.question,
          documents,
        });
        const tasks = agent.proposal?.tasks ?? [];
        result.score = scoreScenario(scenario, cases.forbidden, scenario.question, {
          passages: agent.passages,
          proposed: agent.proposed,
          tasks,
        });
        const pointed = new Set(tasks.map((t) => t.source));
        result.run = {
          steps: agent.steps,
          text: agent.text,
          passages: agent.passages.map((p, i) => ({
            name: p.name,
            page: p.page,
            content: pointed.has(i + 1) ? p.content : "",
          })),
          proposed: agent.proposed,
          tasks,
        };
        result.error = null;
        console.log(
          `${agent.steps} call(s), ${tasks.length} task(s), found ${result.score.found.length}/${result.score.expected}`,
        );
        save();
        await sleep(SCENARIO_GAP_MS);
      } catch (error) {
        if (isDailyQuotaError(error)) throw new QuotaUsedUp(models.answer);
        result.error = error instanceof Error ? error.message : String(error);
        console.log(`failed: ${result.error}`);
        save();
      }
    }
  } catch (error) {
    if (!(error instanceof QuotaUsedUp)) throw error;
    save();
    console.error(
      `\n${error.message}'s free daily quota is used up. Progress is saved in ` +
        `${file.pathname.replace(`${process.cwd()}/`, "")}; run pnpm eval:agent again ` +
        "after it resets (midnight Pacific) to continue.",
    );
    process.exitCode = 2;
    return;
  }

  run.complete = results.every((r) => r.run);
  run.metrics = summarize(results.flatMap((r) => (r.score ? [r.score] : [])));
  save();
  report(run);
  console.log(`\nSaved ${file.pathname.replace(`${process.cwd()}/`, "")}`);
}

function report(run: Run) {
  const m = run.metrics!;
  const only = run.only ? ` · --only ${run.only.join(",")}` : "";
  console.log(`\nAgent eval · ${run.models.answer}${only}`);
  console.table({
    Recall: { score: percent(m.recall), of: `${m.counts.expected} expected tasks` },
    Precision: { score: percent(m.precision), of: `${m.counts.proposed} proposed tasks` },
    "Valid sources": { score: percent(m.validSources), of: `${m.counts.proposed} proposed tasks` },
    "Invented dates": { score: String(m.inventedDates), of: "model's dates (must be 0)" },
    "Invented dates shown": { score: String(m.shownInventedDates), of: "on the card (must be 0)" },
    Forbidden: { score: String(m.forbidden), of: "planted instruction (must be 0)" },
    "Dates right": { score: percent(m.datesRight), of: "expected tasks with a stated date" },
  });
  for (const result of run.results) {
    if (!result.score) {
      console.log(`  ${result.id}: ${result.error ?? "not run"}`);
      continue;
    }
    const s = result.score;
    console.log(
      `  ${result.id}: found ${s.found.length}/${s.expected}` +
        (s.missing.length > 0 ? ` (missing ${s.missing.join(", ")})` : "") +
        `, precision ${percent(share(s.precise, s.proposed))}` +
        (s.invented.length > 0 ? ` (not expected: ${s.invented.join("; ")})` : ""),
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
