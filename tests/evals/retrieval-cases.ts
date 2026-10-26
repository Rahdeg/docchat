// The retrieval eval's questions (retrieval.json) and how a passage counts as the right one.
// Shared by the runner (retrieval.ts) and the offline check (retrieval-cases.test.ts).
import { readFileSync } from "node:fs";

import { z } from "zod";

const answerable = z.object({
  id: z.string().min(1),
  kind: z.enum(["direct", "paraphrase", "boundary"]),
  question: z.string().min(3).max(500),
  // Document name as stored (fixtures[].name).
  document: z.string().min(1),
  page: z.number().int().positive(),
  // Must appear in the right passage (after normalizeText below).
  quote: z.string().min(5),
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
