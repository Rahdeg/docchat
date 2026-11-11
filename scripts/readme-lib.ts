// The README's generated sections: the eval table (`pnpm readme:evals`) and the test counts
// (`pnpm readme:tests`). Each lives between `<!-- name:start -->` and `<!-- name:end -->`
// markers, and the README is run through Prettier after an update, so the result is what
// `pnpm format:check` expects. Pure apart from the file helpers at the bottom; tested in
// readme.test.ts, which also fails if the eval table no longer matches the results files.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";
import { z } from "zod";

import { formatMeasuredAt, formatShare } from "../src/content/eval-summary";
import { latestFullRuns, summarize, type ResultFile } from "./eval-summary-lib";

export const readmeFile = new URL("../README.md", import.meta.url);

export type SectionName = "evals" | "tests";

const markers = (name: SectionName) => ({
  start: `<!-- ${name}:start -->`,
  end: `<!-- ${name}:end -->`,
});

// Replaces what sits between a section's markers, keeping the markers.
export function replaceSection(readme: string, name: SectionName, body: string): string {
  const { start, end } = markers(name);
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`README.md has no ${start} … ${end} section`);
  }
  return `${readme.slice(0, from + start.length)}\n\n${body.trim()}\n\n${readme.slice(to)}`;
}

// The models a run used, as its results file records them.
const runModelsSchema = z.object({
  model: z.string().optional(),
  models: z
    .object({ answer: z.string(), judge: z.string(), embedding: z.string() })
    .partial()
    .optional(),
});

function modelsOf(data: unknown): z.infer<typeof runModelsSchema> {
  const parsed = runModelsSchema.safeParse(data);
  return parsed.success ? parsed.data : {};
}

const code = (value: string) => `\`${value}\``;

// The "Measured, not promised" table: the same numbers as the landing page
// (src/content/eval-summary.json comes from the same summarize()), plus each run's model.
// An eval with no full run, or whose run lacks every metric, has no row.
export function evalsSection(files: readonly ResultFile[]): string {
  const summary = summarize(files);
  const runs = latestFullRuns(files);
  const rows: string[][] = [];

  const { retrieval, answers, agent, injection } = summary;

  if (retrieval && (retrieval.hitAt1 !== undefined || retrieval.hitAt5 !== undefined)) {
    const { model, models } = modelsOf(runs.retrieval?.data);
    const embedding = model ?? models?.embedding;
    const parts = [
      retrieval.hitAt1 !== undefined ? `hit@1 ${formatShare(retrieval.hitAt1)}` : null,
      retrieval.hitAt5 !== undefined ? `hit@5 ${formatShare(retrieval.hitAt5)}` : null,
    ].filter((part) => part !== null);
    rows.push([
      "Retrieval",
      "Search ranks the passage that answers the question first (hit@1) or in the top 5",
      `${parts.join(", ")} over ${retrieval.questions} questions`,
      formatMeasuredAt(retrieval.measuredAt),
      embedding ? code(embedding) : "",
    ]);
  }

  if (answers && (answers.citationAccuracy || answers.grounding !== undefined || answers.honesty)) {
    const { models } = modelsOf(runs.answers?.data);
    const parts = [
      answers.citationAccuracy
        ? `right page cited ${formatShare(answers.citationAccuracy.share)} of ${answers.citationAccuracy.total}`
        : null,
      answers.grounding !== undefined ? `grounding ${formatShare(answers.grounding)}` : null,
      answers.honesty
        ? `“your documents don’t say” ${answers.honesty.passed} of ${answers.honesty.total}`
        : null,
    ].filter((part) => part !== null);
    const model = [
      models?.answer ? code(models.answer) : null,
      models?.judge ? `judge ${code(models.judge)}` : null,
    ].filter((part) => part !== null);
    rows.push([
      "Answers",
      "Answers cite the right page, a judge model finds each cited claim supported, and questions the documents can't answer are declined",
      parts.join(", "),
      formatMeasuredAt(answers.measuredAt),
      model.join(", "),
    ]);
  }

  if (agent?.deadlines) {
    const { models } = modelsOf(runs.agent?.data);
    const { passed, total, inventedDates } = agent.deadlines;
    rows.push([
      "Agent",
      "Turning documents into tasks finds the expected deadlines and duties without inventing dates",
      `${passed} of ${total} found, ${inventedDates} invented ${inventedDates === 1 ? "date" : "dates"}`,
      formatMeasuredAt(agent.measuredAt),
      models?.answer ? code(models.answer) : "",
    ]);
  }

  if (injection?.attacks) {
    const { models } = modelsOf(runs.injection?.data);
    rows.push([
      "Prompt injection",
      "Hostile documents with hidden instructions don't change answers or tasks",
      `${injection.attacks.passed} of ${injection.attacks.total} attacks ignored`,
      formatMeasuredAt(injection.measuredAt),
      models?.answer ? code(models.answer) : "",
    ]);
  }

  if (rows.length === 0) return "_No full eval runs are saved yet._";
  const header = ["Eval", "What it checks", "Latest result", "Run", "Model"];
  return [header, header.map(() => "---"), ...rows]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
}

export type TestCounts = {
  // Vitest tests that passed outside the integration files: what CI runs.
  unitTests: number;
  unitFiles: number;
  // *.integration.test.ts files, which skip without DATABASE_URL (and some without a model key).
  integrationFiles: number;
  e2eTests: number;
  e2eFiles: number;
  countedAt: string; // YYYY-MM-DD
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function testsSection(counts: TestCounts): string {
  return [
    `Counted on ${formatMeasuredAt(counts.countedAt)} by \`pnpm readme:tests\`:`,
    "",
    `- **${plural(counts.unitTests, "Vitest test")}** in ${plural(counts.unitFiles, "file")} (unit, component, and the evals' scoring and fixture checks), on every pull request.`,
    `- **${plural(counts.integrationFiles, "integration test file")}** against a real Postgres (and, for some, a real model), run locally; CI has no database, so they skip there.`,
    `- **${plural(counts.e2eTests, "Playwright test")}** in ${plural(counts.e2eFiles, "file")} (the signed-in flows, public pages, accessibility with axe, and the CSP), on every pull request against a production build with fake AI providers; a few that need the real services, such as an upload to Blob, skip there.`,
  ].join("\n");
}

const readmePath = fileURLToPath(readmeFile);

export async function formatReadme(text: string): Promise<string> {
  const options = await resolveConfig(readmePath);
  return format(text, { ...options, filepath: readmePath });
}

// Renders a section into README.md and formats it. Returns whether the file changed.
export async function writeReadmeSection(name: SectionName, body: string): Promise<boolean> {
  const previous = readFileSync(readmeFile, "utf8");
  const next = await formatReadme(replaceSection(previous, name, body));
  if (next === previous) return false;
  writeFileSync(readmeFile, next);
  return true;
}
