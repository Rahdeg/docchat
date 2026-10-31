// The retrieval eval's questions (retrieval.json) and how a passage counts as the right one.
// Shared by the runner (retrieval.ts) and the offline check (retrieval-cases.test.ts).
import { readFileSync } from "node:fs";

import { z } from "zod";

const regex = z.string().refine((source) => {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}, "not a valid regular expression");

// For the answer eval: what the answer itself must say, for answers the model has to work out
// (a notice period from a rule). Matched case-insensitively against the answer text without
// its markers or bold.
const answerCheck = z.object({
  matches: regex,
  notMatches: regex.optional(),
});

export type AnswerCheck = z.infer<typeof answerCheck>;

const answerable = z.object({
  id: z.string().min(1),
  kind: z.enum(["direct", "paraphrase", "boundary"]),
  question: z.string().min(3).max(500),
  // Document name as stored (fixtures[].name).
  document: z.string().min(1),
  page: z.number().int().positive(),
  // Must appear in the right passage (after normalizeText below).
  quote: z.string().min(5),
  answer: answerCheck.optional(),
  note: z.string().optional(),
});

// A question the documents can't answer. It has no right passage; its best score shows how
// high an irrelevant passage can score, which calibrates MIN_SIMILARITY.
const unanswerable = z.object({
  id: z.string().min(1),
  kind: z.literal("none"),
  question: z.string().min(3).max(500),
  document: z.null(),
  page: z.null(),
  quote: z.null(),
  note: z.string().optional(),
});

export const evalCasesSchema = z.object({
  fixtures: z.array(z.object({ file: z.string(), name: z.string() })).min(1),
  // Questions nothing like the documents. Not scored; their best scores show what an unrelated
  // question looks like, for setting MIN_SIMILARITY when the no-answer question is on-topic.
  offTopic: z.array(z.string().min(3).max(500)).min(1),
  questions: z.array(z.discriminatedUnion("kind", [answerable, unanswerable])).min(1),
});

export type EvalCases = z.infer<typeof evalCasesSchema>;
export type EvalQuestion = EvalCases["questions"][number];
export type AnswerableQuestion = z.infer<typeof answerable>;

export const evalsDir = new URL(".", import.meta.url);

export function loadEvalCases(): EvalCases {
  const raw: unknown = JSON.parse(readFileSync(new URL("retrieval.json", evalsDir), "utf8"));
  return evalCasesSchema.parse(raw);
}

// Off-topic probes have no id in retrieval.json; both evals call them off-topic-1, -2, …
export function offTopicId(index: number): string {
  return `off-topic-${index + 1}`;
}

// --only=id,id: the questions to run (off-topic probes by offTopicId), so a few can be rerun
// without spending the day's quota on all of them. Null when it isn't given. Unknown ids throw,
// listing the known ones.
export function onlyFromArgs(argv: readonly string[], cases: EvalCases): Set<string> | null {
  const arg = argv.find((a) => a.startsWith("--only="));
  if (arg === undefined) return null;
  const ids = arg
    .slice("--only=".length)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const known = [
    ...cases.questions.map((q) => q.id),
    ...cases.offTopic.map((_, i) => offTopicId(i)),
  ];
  const unknown = ids.filter((id) => !known.includes(id));
  if (ids.length === 0 || unknown.length > 0) {
    throw new Error(
      `--only: ${unknown.length > 0 ? `unknown id(s) ${unknown.join(", ")}` : "no ids given"}. ` +
        `Known: ${known.join(", ")}`,
    );
  }
  return new Set(ids);
}

export function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`fixtures/${file}`, evalsDir)));
}

// Collapses whitespace (wrapped lines) and treats curly and straight quotes alike, since PDF
// text extraction turns ' into ’.
export function normalizeText(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

type Candidate = { name: string; page: number | null; content: string };

// The right passage: the expected document and page, and it contains the quote.
export function isHit(question: AnswerableQuestion, passage: Candidate): boolean {
  return (
    passage.name === question.document &&
    passage.page === question.page &&
    normalizeText(passage.content).includes(normalizeText(question.quote))
  );
}
