import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { describe, expect, it } from "vitest";

import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  chunkPage,
  chunkPages,
  type PageChunk,
} from "./chunk";

// Deterministic prose: sentences of 6–23 words, grouped into paragraphs.
const words = [
  "tenant",
  "landlord",
  "rent",
  "notice",
  "deposit",
  "property",
  "agreement",
  "repairs",
  "month",
  "written",
  "payment",
  "schedule",
  "clause",
  "period",
  "reasonable",
];

function sentence(seed: number): string {
  const length = 6 + ((seed * 7) % 18);
  const body = Array.from({ length }, (_, i) => words[(seed * 31 + i * 17) % words.length]);
  const text = body.join(" ");
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

function prose(paragraphCount: number, sentencesPerParagraph: number, seed = 1): string {
  return Array.from({ length: paragraphCount }, (_, p) =>
    Array.from({ length: sentencesPerParagraph }, (_, s) =>
      sentence(seed + p * sentencesPerParagraph + s),
    ).join(" "),
  ).join("\n\n");
}

function expectExactSlices(text: string, chunks: PageChunk[]) {
  for (const chunk of chunks) {
    expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
  }
}

function expectFullCoverage(text: string, chunks: PageChunk[]) {
  const covered = new Array<boolean>(text.length).fill(false);
  for (const { startOffset, endOffset } of chunks) {
    for (let i = startOffset; i < endOffset; i += 1) covered[i] = true;
  }
  const missed = [...text].flatMap((char, i) => (/\s/.test(char) || covered[i] ? [] : [i]));
  expect(missed).toEqual([]);
}

// True when `offset` is where a sentence starts: the beginning of the text, or after
// sentence-ending punctuation and whitespace.
function isSentenceStart(text: string, offset: number): boolean {
  return /(^|[.!?]\s+)$/.test(text.slice(0, offset));
}

describe("chunkPage", () => {
  const text = prose(12, 8);
  const chunks = chunkPage(text, 1);

  it("produces several chunks for a long page", () => {
    expect(countTokens(text)).toBeGreaterThan(CHUNK_TARGET_TOKENS * 3);
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("records offsets that slice exactly to each chunk's content", () => {
    expectExactSlices(text, chunks);
  });

  it("covers every non-whitespace character of the page", () => {
    expectFullCoverage(text, chunks);
  });

  it("keeps chunks at or under the target size, and most of them close to it", () => {
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(countTokens(chunk.content));
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + 5);
    }
    const full = chunks.slice(0, -1);
    const average = full.reduce((sum, c) => sum + c.tokenCount, 0) / full.length;
    expect(average).toBeGreaterThan(CHUNK_TARGET_TOKENS * 0.6);
  });

  it("overlaps consecutive chunks by roughly 15%", () => {
    const overlaps = chunks.slice(1).map((chunk, i) => {
      const previous = chunks[i]!;
      expect(chunk.startOffset).toBeGreaterThan(previous.startOffset);
      expect(chunk.endOffset).toBeGreaterThan(previous.endOffset);
      expect(chunk.startOffset).toBeLessThan(previous.endOffset);
      return countTokens(text.slice(chunk.startOffset, previous.endOffset));
    });

    for (const tokens of overlaps) {
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(CHUNK_OVERLAP_TOKENS * 2 + 5);
    }
    const average = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;
    expect(average).toBeGreaterThan(CHUNK_OVERLAP_TOKENS * 0.6);
    expect(average).toBeLessThan(CHUNK_OVERLAP_TOKENS * 1.6);
  });

  it("never cuts a sentence in the middle when sentences are short", () => {
    for (const chunk of chunks) {
      expect(isSentenceStart(text, chunk.startOffset)).toBe(true);
      expect(chunk.content).toMatch(/[.!?]$/);
    }
  });

  it("numbers chunks in order on the given page", () => {
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1]));
  });

  it("prefers to end a chunk at a paragraph break", () => {
    // Paragraphs of ~150 tokens: a chunk can hold three, and should stop at a break rather
    // than run into the middle of the fourth.
    const paragraphText = prose(10, 9, 3);
    const breaks = new Set([...paragraphText.matchAll(/\n\n/g)].map((m) => m.index));
    const result = chunkPage(paragraphText, 1);
    const endsAtBreak = result.slice(0, -1).filter((c) => breaks.has(c.endOffset));
    expect(endsAtBreak.length).toBe(result.length - 1);
  });

  it("doesn't split sentences at line breaks inside a paragraph (wrapped PDF lines)", () => {
    // Wrap every ~60 characters, mid-sentence, like text extracted from a PDF.
    const wrapped = prose(6, 10, 5).replace(/(.{60}\S*) /g, "$1\n");
    expect(wrapped).toMatch(/[a-z]\n[a-z]/);
    const result = chunkPage(wrapped, 1);

    expectExactSlices(wrapped, result);
    expectFullCoverage(wrapped, result);
    for (const chunk of result) expect(chunk.content).toMatch(/[.!?]$/);
  });

  it("splits a sentence longer than the target at whitespace", () => {
    const long = `${Array.from({ length: 1200 }, (_, i) => words[i % words.length]).join(" ")}.`;
    const page = `Short opener. ${long} Short closer.`;
    const result = chunkPage(page, 1);

    expectExactSlices(page, result);
    expectFullCoverage(page, result);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + 5);
      // Pieces start and end on word boundaries.
      expect(/\s/.test(page[chunk.startOffset - 1] ?? " ")).toBe(true);
      expect(/\s/.test(page[chunk.endOffset] ?? " ")).toBe(true);
    }
  });

  it("cuts text with no whitespace at all into slices", () => {
    const blob = "x".repeat(20_000);
    const result = chunkPage(blob, 1);

    expect(result.length).toBeGreaterThan(1);
    expectExactSlices(blob, result);
    expectFullCoverage(blob, result);
  });

  it("returns nothing for an empty or blank page", () => {
    expect(chunkPage("", 1)).toEqual([]);
    expect(chunkPage(" \n\n\t ", 1)).toEqual([]);
  });

  it("returns a single trimmed chunk for a short page", () => {
    const page = "\n  Just one sentence here.  \n";
    const [only, ...rest] = chunkPage(page, 1);

    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      content: "Just one sentence here.",
      startOffset: 3,
      endOffset: 26,
    });
  });
});

describe("chunkPages", () => {
  it("keeps chunks within their page and numbers positions across the document", () => {
    const pages = [prose(6, 8, 1), "", prose(2, 3, 9)];
    const chunks = chunkPages(pages);

    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    expect(chunks.some((c) => c.page === 2)).toBe(false);
    for (const chunk of chunks) {
      const page = pages[chunk.page - 1]!;
      expect(page.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.content);
    }
    expectFullCoverage(
      pages[0]!,
      chunks.filter((c) => c.page === 1),
    );
    expectFullCoverage(
      pages[2]!,
      chunks.filter((c) => c.page === 3),
    );
  });
});
