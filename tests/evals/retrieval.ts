// Retrieval eval: indexes the fixture documents for a dedicated eval user, asks every question
// in retrieval.json through searchPassages (no similarity floor, so it measures raw ranking),
// and prints hit@1, hit@3, hit@5 and MRR, the misses, and the numbers for calibrating
// MIN_SIMILARITY. Saves the run to tests/evals/results/retrieval-<date>.json.
//
// Run: pnpm eval:retrieval. Calls AI Gateway (a fraction of a cent per run), so it isn't in CI.
// Uses DATABASE_URL (your Neon dev branch) and only touches the eval user's rows.
import "../../scripts/lib/load-env";

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { eq } from "drizzle-orm";

import { CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS } from "@/server/ai/chunk";
import { EMBEDDING_DIMENSIONS } from "@/server/ai/constants";
import { EMBEDDING_MODEL, MIN_SIMILARITY } from "@/server/ai/models";
import { searchPassages, type Passage } from "@/server/ai/retrieve";
import { db } from "@/server/db";
import { document } from "@/server/db/schema";
import { indexDocument } from "@/server/ingest/index-document";

import { assertDevelopment } from "../../scripts/lib/assert-development";
import { evalsDir, fixtureBytes, isHit, loadEvalCases, type EvalQuestion } from "./retrieval-cases";

const EVAL_USER_ID = "eval_retrieval";
const LIMIT = 5;

type QuestionResult = {
  id: string;
  kind: EvalQuestion["kind"];
  question: string;
  expected: { document: string; page: number } | null;
  // 1-based rank of the first right passage, or null if none of the top LIMIT is right.
  rank: number | null;
  // Similarity of that passage.
  hitSimilarity: number | null;
  top: { document: string; page: number | null; similarity: number }[];
};

async function indexFixtures(fixtures: { file: string; name: string }[]) {
  // Start clean: documents cascade to their pages and chunks. Usage rows stay (real spend).
  await db.delete(document).where(eq(document.userId, EVAL_USER_ID));

  for (const fixture of fixtures) {
    const bytes = fixtureBytes(fixture.file);
    const [row] = await db
      .insert(document)
      .values({
        userId: EVAL_USER_ID,
        name: fixture.name,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        blobPathname: `users/${EVAL_USER_ID}/eval-${fixture.file}`,
      })
      .returning({ id: document.id });
    await indexDocument(EVAL_USER_ID, row!.id, { load: async () => bytes });

    const [indexed] = await db.select().from(document).where(eq(document.id, row!.id));
    if (indexed?.status !== "ready") {
      throw new Error(`Indexing ${fixture.name} failed: ${indexed?.error ?? "unknown error"}`);
    }
  }
}

function summarize(passages: Passage[]): QuestionResult["top"] {
  return passages.map((p) => ({ document: p.name, page: p.page, similarity: round(p.similarity) }));
}

function round(value: number, places = 4): number {
  return Math.round(value * 10 ** places) / 10 ** places;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

async function main() {
  assertDevelopment(process.env.NODE_ENV);
  const cases = loadEvalCases();
  const startedAt = new Date();

  console.log(`Indexing ${cases.fixtures.length} fixture document(s) for ${EVAL_USER_ID}…`);
  const indexStart = performance.now();
  await indexFixtures(cases.fixtures);
  const indexMs = Math.round(performance.now() - indexStart);

  const results: QuestionResult[] = [];
  const searchStart = performance.now();
  for (const question of cases.questions) {
    const passages = await searchPassages({
      userId: EVAL_USER_ID,
      query: question.question,
      limit: LIMIT,
    });
    let rank: number | null = null;
    if (question.kind !== "none") {
      const index = passages.findIndex((p) => isHit(question, p));
      rank = index === -1 ? null : index + 1;
    }
    results.push({
      id: question.id,
      kind: question.kind,
      question: question.question,
      expected:
        question.kind === "none" ? null : { document: question.document, page: question.page },
      rank,
      hitSimilarity: rank ? round(passages[rank - 1]!.similarity) : null,
      top: summarize(passages),
    });
  }
  const searchMs = Math.round(performance.now() - searchStart);

  // Off-topic probes: not scored, only their best score is kept, for the floor.
  const offTopic: { question: string; bestSimilarity: number }[] = [];
  for (const question of cases.offTopic) {
    const [best] = await searchPassages({ userId: EVAL_USER_ID, query: question, limit: 1 });
    offTopic.push({ question, bestSimilarity: round(best?.similarity ?? 0) });
  }

  // Metrics over the questions that have a right answer.
  const answerable = results.filter((r) => r.kind !== "none");
  const hitAt = (k: number) =>
    answerable.filter((r) => r.rank !== null && r.rank <= k).length / answerable.length;
  const mrr = answerable.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / answerable.length;
  const metrics = {
    questions: answerable.length,
    hitAt1: round(hitAt(1)),
    hitAt3: round(hitAt(3)),
    hitAt5: round(hitAt(5)),
    mrr: round(mrr),
  };

  // Floor calibration: the floor belongs above what a question the documents can't answer
  // scores, and below every right passage. When the no-answer question is on-topic (it shares
  // vocabulary with a document), it can score as high as right passages; then the floor can
  // only hide unrelated questions, so it goes between the off-topic probes and the right ones.
  const offTopicBest = Math.max(...offTopic.map((o) => o.bestSimilarity));
  const noAnswerBest = Math.max(
    ...results.filter((r) => r.kind === "none").map((r) => r.top[0]?.similarity ?? 0),
  );
  const hitScores = answerable.flatMap((r) => (r.hitSimilarity === null ? [] : [r.hitSimilarity]));
  const lowestHit = hitScores.length > 0 ? Math.min(...hitScores) : null;
  const belowFloor = answerable.filter(
    (r) => r.hitSimilarity !== null && r.hitSimilarity < MIN_SIMILARITY,
  );
  const below = (score: number) => lowestHit !== null && score < lowestHit;
  const separates = below(noAnswerBest) ? "no-answer" : below(offTopicBest) ? "off-topic" : null;
  const floorFrom = separates === "no-answer" ? noAnswerBest : offTopicBest;
  const calibration = {
    minSimilarity: MIN_SIMILARITY,
    noAnswerBestSimilarity: noAnswerBest,
    offTopicBestSimilarity: offTopicBest,
    lowestHitSimilarity: lowestHit,
    // Halfway between the highest score that should be hidden and the lowest right passage.
    suggestedFloor: separates && lowestHit !== null ? round((floorFrom + lowestHit) / 2, 2) : null,
    separates,
    hitsBelowFloor: belowFloor.map((r) => r.id),
    offTopic,
  };

  // Report.
  console.log(`\nRetrieval eval · ${EMBEDDING_MODEL} · ${answerable.length} answerable questions`);
  console.log(`  hit@1  ${percent(metrics.hitAt1)}`);
  console.log(`  hit@3  ${percent(metrics.hitAt3)}`);
  console.log(`  hit@5  ${percent(metrics.hitAt5)}`);
  console.log(`  MRR    ${metrics.mrr.toFixed(3)}`);

  const misses = answerable.filter((r) => r.rank === null || r.rank > 1);
  if (misses.length > 0) {
    console.log("\nNot ranked first:");
    console.table(
      misses.map((r) => ({
        id: r.id,
        kind: r.kind,
        rank: r.rank ?? "miss",
        expected: `${r.expected!.document} p.${r.expected!.page}`,
        "got first": r.top[0]
          ? `${r.top[0].document} p.${r.top[0].page} (${r.top[0].similarity})`
          : "nothing",
      })),
    );
  }

  console.log("\nSimilarity floor");
  console.log(`  best score, off-topic questions  ${offTopicBest.toFixed(3)}`);
  console.log(`  best score, no-answer question   ${noAnswerBest.toFixed(3)}`);
  console.log(`  lowest score of a right passage  ${lowestHit?.toFixed(3) ?? "n/a"}`);
  console.log(`  MIN_SIMILARITY                   ${MIN_SIMILARITY}`);
  if (separates === "no-answer") {
    console.log(`  suggested floor                  ${calibration.suggestedFloor}`);
  } else if (separates === "off-topic") {
    console.log(
      `  suggested floor                  ${calibration.suggestedFloor} (hides off-topic ` +
        "questions; the no-answer question is on-topic and scores like a right passage)",
    );
  } else {
    console.log("  No floor separates wrong passages from right ones.");
  }
  if (offTopicBest >= MIN_SIMILARITY) {
    console.warn(`  ! An off-topic question's best passage (${offTopicBest}) passes the floor.`);
  }
  for (const r of belowFloor) {
    console.warn(
      `  ! ${r.id}: the right passage scores ${r.hitSimilarity}, below MIN_SIMILARITY, so /chat would hide it.`,
    );
  }

  // Save.
  const gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  // Uncommitted changes other than earlier results files.
  const dirty =
    execSync("git status --porcelain -- . ':!tests/evals/results'", { encoding: "utf8" }).trim()
      .length > 0;
  const output = {
    date: startedAt.toISOString(),
    git: { sha: gitSha, dirty },
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    chunking: { targetTokens: CHUNK_TARGET_TOKENS, overlapTokens: CHUNK_OVERLAP_TOKENS },
    limit: LIMIT,
    metrics,
    calibration,
    timings: { indexMs, searchMs, searchMsPerQuestion: Math.round(searchMs / results.length) },
    results,
  };
  const resultsDir = new URL("results/", evalsDir);
  mkdirSync(resultsDir, { recursive: true });
  const file = new URL(`retrieval-${startedAt.toISOString().slice(0, 10)}.json`, resultsDir);
  writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\nSaved ${file.pathname.replace(`${process.cwd()}/`, "")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
