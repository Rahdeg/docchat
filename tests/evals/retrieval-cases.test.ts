import { beforeAll, describe, expect, it } from "vitest";

import { chunkPages, type PageChunk } from "@/server/ai/chunk";
import { extractPages } from "@/server/ingest/extract";

import {
  fixtureBytes,
  isHit,
  loadEvalCases,
  normalizeText,
  type AnswerableQuestion,
} from "./retrieval-cases";

// Checks the eval's questions against its fixtures without calling any model, so a change to
// the fixtures, the extractor or the chunker that breaks a question fails here (and in CI)
// instead of silently lowering the eval score.
const cases = loadEvalCases();
const answerable = cases.questions.filter((q): q is AnswerableQuestion => q.kind !== "none");

const documents = new Map<string, { pages: string[]; chunks: PageChunk[] }>();

beforeAll(async () => {
  for (const fixture of cases.fixtures) {
    const pages = await extractPages(fixtureBytes(fixture.file), "pdf");
    documents.set(fixture.name, { pages, chunks: chunkPages(pages) });
  }
});

function chunksWithQuote(question: AnswerableQuestion) {
  const { chunks } = documents.get(question.document)!;
  return chunks.filter((c) =>
    isHit(question, { name: question.document, page: c.page, content: c.content }),
  );
}

describe("retrieval eval cases", () => {
  it("has 15 questions with unique ids, including every kind", () => {
    expect(cases.questions).toHaveLength(15);
    expect(new Set(cases.questions.map((q) => q.id)).size).toBe(15);
    expect(new Set(cases.questions.map((q) => q.kind))).toEqual(
      new Set(["direct", "paraphrase", "boundary", "none"]),
    );
  });

  it.each(answerable.map((q) => [q.id, q] as const))(
    "%s: the quote is on the expected page and in at least one chunk",
    (_id, question) => {
      const doc = documents.get(question.document);
      expect(doc, `no fixture named ${question.document}`).toBeDefined();
      expect(normalizeText(doc!.pages[question.page - 1] ?? "")).toContain(
        normalizeText(question.quote),
      );
      expect(chunksWithQuote(question).length).toBeGreaterThan(0);
    },
  );

  it.each(answerable.filter((q) => q.kind === "boundary").map((q) => [q.id, q] as const))(
    "%s: the quote is only in the later of two chunks on its page",
    (_id, question) => {
      const { chunks } = documents.get(question.document)!;
      const onPage = chunks.filter((c) => c.page === question.page);

      expect(onPage.length).toBeGreaterThanOrEqual(2);
      expect(chunksWithQuote(question).map((c) => c.position)).toEqual([onPage.at(-1)!.position]);
    },
  );

  it("has no expected passage for the unanswerable question", () => {
    const none = cases.questions.filter((q) => q.kind === "none");
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ document: null, page: null, quote: null });
  });
});
