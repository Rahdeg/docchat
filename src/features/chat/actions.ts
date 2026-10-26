"use server";

import { z } from "zod";

import { authedAction } from "@/lib/action";
import { MIN_SIMILARITY } from "@/server/ai/models";
import { searchPassages } from "@/server/ai/retrieve";

import { MAX_DOCUMENTS } from "../documents/upload-rules";
import { PASSAGE_LIMIT, QUERY_MAX_CHARS, QUERY_MIN_CHARS } from "./find-rules";

const findInput = z.object({
  query: z
    .string()
    .trim()
    .min(QUERY_MIN_CHARS, `Ask with at least ${QUERY_MIN_CHARS} characters.`)
    .max(QUERY_MAX_CHARS, `Keep it under ${QUERY_MAX_CHARS} characters.`),
  // Leave out to search every ready document. An empty list would match nothing.
  documentIds: z.array(z.uuid()).min(1).max(MAX_DOCUMENTS).optional(),
});

// The passages DocChat would answer from, best first. Weak matches are dropped.
export const findPassages = authedAction(findInput, async (input, { userId }) =>
  searchPassages({
    userId,
    query: input.query,
    documentIds: input.documentIds,
    limit: PASSAGE_LIMIT,
    minSimilarity: MIN_SIMILARITY,
  }),
);
