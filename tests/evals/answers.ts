// Answer eval: asks every question in retrieval.json (and the off-topic probes) through the
// answer pipeline, judges each cited claim against its passage, and prints:
//
// - citation accuracy: the expected page is among the cited sources (answerable questions)
// - grounding: the share of cited claims the judge says their passage supports
// - honesty: the no-answer question gets "Your documents don't say" with no citations; the
//   off-topic probes get that or the canned line about DocChat (src/features/chat/about.ts)
// - quote match rate: the share of citations whose quote was found in its passage
//
// Saves the run to tests/evals/results/answers-<date>.json.
//
// Run: pnpm eval:answers. Not in CI: it calls the chat provider (CHAT_PROVIDER, or the model in
// CHAT_ANSWER_MODEL) about 17 times and the judge about 30. The Gemini free tier allows 20
// answers a day per model, so calls are spaced out, progress is saved after every call, and a
// run stopped by the quota continues where it left off when run again (--fresh starts over).
// Uses DATABASE_URL (your Neon dev branch) and only touches the eval user's rows.
import "../../scripts/lib/load-env";

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";

import { answerQuestion, type Answer } from "@/server/ai/answer";
import { isDailyQuotaError, sleep } from "@/server/ai/call-model";
import { judgeClaim, type Verdict } from "@/server/ai/judge";
import { chatConfig, EMBEDDING_MODEL, MIN_SIMILARITY } from "@/server/ai/models";
import { db } from "@/server/db";
import { document } from "@/server/db/schema";

import { assertDevelopment } from "../../scripts/lib/assert-development";
import {
  citedClaims,
  citesPage,
  isAboutReply,
  isHonestNoAnswer,
  share,
  type EvalAnswer,
} from "./answer-metrics";
import { indexFixtures } from "./index-fixtures";
import { evalsDir, loadEvalCases } from "./retrieval-cases";

const EVAL_USER_ID = "eval_answers";
// Between answer calls, and between judge calls: under the free tier's per-minute limits.
const ANSWER_GAP_MS = 6_000;
const JUDGE_GAP_MS = 2_500;

type Kind = "direct" | "paraphrase" | "boundary" | "none" | "off-topic";

type StoredAnswer = EvalAnswer & { query: string; generated: boolean; about?: boolean };

type JudgedClaim = {
  claim: string;
  number: number;
  document: string;
  page: number | null;
  verdict: Verdict | null;
};

type QuestionResult = {
  id: string;
  kind: Kind;
  question: string;
  expected: { document: string; page: number } | null;
  answer: StoredAnswer | null;
  claims: JudgedClaim[] | null;
  error: string | null;
};

type Run = {
  date: string;
  git: { sha: string; dirty: boolean };
  models: { answer: string; judge: string; embedding: string };
  minSimilarity: number;
  complete: boolean;
  metrics: ReturnType<typeof computeMetrics> | null;
  results: QuestionResult[];
};

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

// Only the cited passages' text is kept, to judge from and to read in the results file.
function store(answer: Answer): StoredAnswer {
  const cited = new Set(answer.citations.map((c) => c.source));
  return {
    query: answer.query,
    text: answer.text,
    noAnswer: answer.noAnswer,
    about: answer.about,
    generated: answer.generated,
    citations: answer.citations,
    passages: answer.passages.map((p, i) => ({
      name: p.name,
      page: p.page,
      content: cited.has(i + 1) ? p.content : "",
    })),
  };
}

// The no-answer question must decline; an off-topic probe may also get the line about DocChat.
function isHonest(result: QuestionResult): boolean {
  const answer = result.answer!;
  return isHonestNoAnswer(answer) || (result.kind === "off-topic" && isAboutReply(answer));
}

function computeMetrics(results: QuestionResult[]) {
  const answered = results.filter((r) => r.answer);
  const answerable = answered.filter((r) => r.expected);
  const mustDecline = answered.filter((r) => r.kind === "none" || r.kind === "off-topic");
  const allClaims = answered.flatMap((r) => r.claims ?? []);
  const claims = allClaims.filter((c) => c.verdict);
  const citations = answered.flatMap((r) => r.answer!.citations);
  return {
    questions: results.length,
    answered: answered.length,
    citationAccuracy: share(
      answerable.filter((r) => citesPage(r.answer!, r.expected!.document, r.expected!.page)).length,
      answerable.length,
    ),
    grounding: share(claims.filter((c) => c.verdict!.supported).length, claims.length),
    honesty: share(mustDecline.filter(isHonest).length, mustDecline.length),
    quoteMatchRate: share(citations.filter((c) => c.matched).length, citations.length),
    counts: {
      answerable: answerable.length,
      mustDecline: mustDecline.length,
      claims: claims.length,
      // Claims the judge couldn't give a verdict on aren't scored.
      claimsUnjudged: allClaims.length - claims.length,
      citations: citations.length,
      // Answerable questions answered "Your documents don't say".
      declinedAnswerable: answerable.filter((r) => r.answer!.noAnswer).length,
    },
  };
}

class QuotaUsedUp extends Error {}

async function main() {
  assertDevelopment(process.env.NODE_ENV);
  const fresh = process.argv.includes("--fresh");
  const cases = loadEvalCases();
  const startedAt = new Date();
  const resultsDir = new URL("results/", evalsDir);
  mkdirSync(resultsDir, { recursive: true });
  const file = new URL(`answers-${startedAt.toISOString().slice(0, 10)}.json`, resultsDir);
  const models = {
    answer: chatConfig.models.answer.id,
    judge: chatConfig.models.judge.id,
    embedding: EMBEDDING_MODEL,
  };

  // The questions, then the off-topic probes.
  const questions: Omit<QuestionResult, "answer" | "claims" | "error">[] = [
    ...cases.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      question: q.question,
      expected: q.kind === "none" ? null : { document: q.document, page: q.page },
    })),
    ...cases.offTopic.map((question, i) => ({
      id: `off-topic-${i + 1}`,
      kind: "off-topic" as const,
      question,
      expected: null,
    })),
  ];

  // Continue an unfinished run of today's with the same models.
  let previous: Run | null = null;
  if (!fresh && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Run;
    if (!saved.complete && JSON.stringify(saved.models) === JSON.stringify(models))
      previous = saved;
  }
  const results: QuestionResult[] = questions.map((q) => {
    const done = previous?.results.find((r) => r.id === q.id && r.answer);
    return done ?? { ...q, answer: null, claims: null, error: null };
  });

  const gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const dirty =
    execSync("git status --porcelain -- . ':!tests/evals/results'", { encoding: "utf8" }).trim()
      .length > 0;
  const run: Run = {
    date: previous?.date ?? startedAt.toISOString(),
    git: { sha: gitSha, dirty },
    models,
    minSimilarity: MIN_SIMILARITY,
    complete: false,
    metrics: null,
    results,
  };
  const save = () => writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);

  // Index once; a resumed run reuses the indexed fixtures.
  const ready = await db.$count(
    document,
    and(eq(document.userId, EVAL_USER_ID), eq(document.status, "ready")),
  );
  if (!previous || ready !== cases.fixtures.length) {
    console.log(`Indexing ${cases.fixtures.length} fixture document(s) for ${EVAL_USER_ID}…`);
    await indexFixtures(EVAL_USER_ID, cases.fixtures);
  }
  if (previous) {
    console.log(`Continuing ${previous.date}: ${results.filter((r) => r.answer).length} answered.`);
  }

  console.log(`Answering with ${models.answer}, judging with ${models.judge}`);
  const documentNames = cases.fixtures.map((f) => f.name);
  try {
    for (const result of results) {
      if (result.answer) continue;
      process.stdout.write(`  ${result.id}… `);
      try {
        const answer = await answerQuestion({
          userId: EVAL_USER_ID,
          query: result.question,
          documentNames,
        });
        result.answer = store(answer);
        result.error = null;
        console.log(
          answer.generated
            ? `${answer.citations.length} cited`
            : answer.about
              ? "about DocChat"
              : "no passages",
        );
        save();
        if (answer.generated) await sleep(ANSWER_GAP_MS);
      } catch (error) {
        if (isDailyQuotaError(error)) throw new QuotaUsedUp(models.answer);
        result.error = error instanceof Error ? error.message : String(error);
        console.log(`failed: ${result.error}`);
        save();
      }
    }

    for (const result of results) {
      if (!result.answer || result.claims?.every((c) => c.verdict)) continue;
      const claims = citedClaims(result.answer);
      result.claims =
        result.claims ??
        claims.map((c) => ({
          claim: c.claim,
          number: c.number,
          document: c.passage.name,
          page: c.passage.page,
          verdict: null,
        }));
      for (const [i, claim] of claims.entries()) {
        if (result.claims[i]!.verdict) continue;
        try {
          result.claims[i]!.verdict = await judgeClaim(
            EVAL_USER_ID,
            claim.claim,
            claim.passage.content,
          );
        } catch (error) {
          if (isDailyQuotaError(error)) throw new QuotaUsedUp(models.judge);
          console.warn(`  Couldn't judge a claim in ${result.id}:`, error);
        }
        save();
        await sleep(JUDGE_GAP_MS);
      }
    }
  } catch (error) {
    if (!(error instanceof QuotaUsedUp)) throw error;
    save();
    console.error(
      `\n${error.message}'s free daily quota is used up. Progress is saved in ` +
        `${file.pathname.replace(`${process.cwd()}/`, "")}; run pnpm eval:answers again ` +
        "after it resets (midnight Pacific) to continue.",
    );
    process.exitCode = 2;
    return;
  }

  run.complete = results.every((r) => r.answer && r.claims?.every((c) => c.verdict));
  run.metrics = computeMetrics(results);
  save();
  report(run);
  console.log(`\nSaved ${file.pathname.replace(`${process.cwd()}/`, "")}`);
}

function report(run: Run) {
  const m = run.metrics!;
  console.log(`\nAnswer eval · ${run.models.answer} · judge ${run.models.judge}`);
  console.table({
    "Citation accuracy": {
      score: percent(m.citationAccuracy),
      of: `${m.counts.answerable} answerable questions`,
    },
    Grounding: {
      score: percent(m.grounding),
      of: `${m.counts.claims} cited claims${m.counts.claimsUnjudged > 0 ? ` (${m.counts.claimsUnjudged} not judged)` : ""}`,
    },
    Honesty: {
      score: percent(m.honesty),
      of: `${m.counts.mustDecline} no-answer and off-topic questions`,
    },
    "Quote match rate": { score: percent(m.quoteMatchRate), of: `${m.counts.citations} citations` },
  });

  const failures: Record<string, string>[] = [];
  for (const r of run.results) {
    const a = r.answer;
    if (r.error || !a) {
      failures.push({ id: r.id, check: "error", detail: r.error ?? "not answered" });
      continue;
    }
    if (r.expected && !citesPage(a, r.expected.document, r.expected.page)) {
      const cited = a.citations.map(
        (c) => `${a.passages[c.source - 1]?.name} p.${a.passages[c.source - 1]?.page}`,
      );
      failures.push({
        id: r.id,
        check: "citation",
        detail: `wanted ${r.expected.document} p.${r.expected.page}; cited ${cited.join(", ") || "nothing"}${a.noAnswer ? " (said the documents don't say)" : ""}`,
      });
    }
    if ((r.kind === "none" || r.kind === "off-topic") && !isHonest(r)) {
      failures.push({ id: r.id, check: "honesty", detail: a.text.slice(0, 120) });
    }
    for (const c of r.claims ?? []) {
      if (c.verdict && !c.verdict.supported) {
        failures.push({
          id: r.id,
          check: "grounding",
          detail: `[${c.number}] "${c.claim}" — ${c.verdict.reason}`,
        });
      }
    }
    for (const c of a.citations.filter((c) => !c.matched)) {
      failures.push({
        id: r.id,
        check: "quote",
        detail: `[${c.number}] ${c.quote ?? "(no quote)"}`,
      });
    }
  }
  if (failures.length > 0) {
    console.log("\nFailures:");
    console.table(failures);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
