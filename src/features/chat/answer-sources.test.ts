import { describe, expect, it } from "vitest";

import { ABOUT_ANSWER } from "./about";
import { answerSources, passagesRead, sourceLabel } from "./answer-sources";
import type { ChatUIMessage, Citation, PassageData } from "./message";

const passage = (n: number, page: number | null = 3): PassageData => ({
  chunkId: `00000000-0000-4000-8000-00000000000${n}`,
  documentId: "11111111-1111-4111-8111-111111111111",
  name: "Tenancy agreement.pdf",
  mimeType: "application/pdf",
  hasFile: true,
  page,
  content: `Clause ${n}.`,
  startOffset: 0,
  endOffset: 10,
  similarity: 0.7,
});

const cite = (number: number, source: number): Citation => ({
  number,
  source,
  quote: null,
  start: 0,
  end: 10,
  matched: false,
});

function answer(text: string, passages: PassageData[], citations: Citation[]): ChatUIMessage {
  return {
    id: "a",
    role: "assistant",
    parts: [
      { type: "data-passages", id: "passages", data: { query: "rent", passages } },
      { type: "text", text },
      { type: "data-citations", id: "citations", data: { final: true, citations } },
    ],
  };
}

describe("passagesRead", () => {
  it("marks only the passages the answer cites, in search order", () => {
    const passages = [passage(1), passage(2), passage(3)];
    const sources = answerSources(answer("Rent is due [1].", passages, [cite(1, 2)]))!;

    expect(passagesRead(sources).map((p) => [p.passage.chunkId, p.cited])).toEqual([
      [passages[0]!.chunkId, false],
      [passages[1]!.chunkId, true],
      [passages[2]!.chunkId, false],
    ]);
  });

  it("marks nothing in a 'don't say' answer, so no chip is yellow", () => {
    const sources = answerSources(
      answer("Your documents don't say anything about that.", [passage(1)], []),
    )!;

    expect(passagesRead(sources).map((p) => p.cited)).toEqual([false]);
  });
});

describe("answerSources", () => {
  it("has no sources for the line about DocChat, even with passages read", () => {
    expect(answerSources(answer(ABOUT_ANSWER, [passage(1)], []))).toBeNull();
  });
});

describe("sourceLabel", () => {
  it("drops the file extension, as the Library does", () => {
    expect(sourceLabel(passage(1))).toBe("Tenancy agreement, page 3");
    expect(sourceLabel({ ...passage(1, null), name: "notes.v2.md" })).toBe("notes.v2");
  });
});
