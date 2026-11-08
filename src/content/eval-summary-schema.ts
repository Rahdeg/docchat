import { z } from "zod";

// The shape of eval-summary.json (written by scripts/eval-summary.ts). Separate from the
// loader so the script can use it before the JSON exists.

const date = z.iso.date();
const share = z.number().min(0).max(1);
const count = z.object({ passed: z.int().min(0), total: z.int().positive() });

export const evalSummarySchema = z.object({
  answers: z
    .object({
      measuredAt: date,
      // The expected page is among the cited sources, over answerable questions.
      citationAccuracy: z.object({ share, total: z.int().positive() }).optional(),
      // Questions the documents can't answer, answered with "Your documents don't say".
      honesty: count.optional(),
      // Cited claims the judge says their passage supports.
      grounding: share.optional(),
    })
    .optional(),
  agent: z
    .object({
      measuredAt: date,
      // Expected tasks (deadlines and duties) found, and dates no passage states.
      deadlines: count.extend({ inventedDates: z.int().min(0) }).optional(),
    })
    .optional(),
  injection: z
    .object({
      measuredAt: date,
      // Hostile documents whose planted instructions were ignored.
      attacks: count.optional(),
    })
    .optional(),
  retrieval: z
    .object({
      measuredAt: date,
      questions: z.int().positive(),
      hitAt1: share.optional(),
      hitAt5: share.optional(),
    })
    .optional(),
});

export type EvalSummary = z.infer<typeof evalSummarySchema>;
