import "server-only";

import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";

// Sizes are in cl100k tokens, the tokenizer of OpenAI's 1536-dimension embedding models
// (docs/adr/0004). Counts are close enough for other models of that size.
export const CHUNK_TARGET_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 75; // ~15% of the target

// Once a chunk is this full (counting its overlap), it would rather end at a paragraph break
// than run into the middle of the next paragraph.
const PARAGRAPH_BREAK_THRESHOLD = 0.6;

export type ChunkOptions = {
  targetTokens?: number;
  overlapTokens?: number;
};

export type PageChunk = {
  // Exactly pageText.slice(startOffset, endOffset).
  content: string;
  // 1-based page number.
  page: number;
  // 0-based order across the whole document.
  position: number;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
};

// A span of page text that is never split: a sentence, or a piece of one that was too long.
type Unit = { start: number; end: number; tokens: number; paragraphEnd: boolean };

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// Splits each page into overlapping chunks. Pages never share a chunk, so every chunk has
// exactly one page and its offsets point into that page's text.
export function chunkPages(pages: readonly string[], options: ChunkOptions = {}): PageChunk[] {
  const chunks: PageChunk[] = [];
  pages.forEach((text, index) => {
    for (const chunk of chunkPage(text, index + 1, options)) {
      chunks.push({ ...chunk, position: chunks.length });
    }
  });
  return chunks;
}

// Chunks of one page, numbered from position 0.
export function chunkPage(text: string, page: number, options: ChunkOptions = {}): PageChunk[] {
  const target = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlap = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  const units = toUnits(text, target);
  const chunks: PageChunk[] = [];

  let first = 0;
  // Index of the first unit the previous chunk didn't include. Every chunk must reach past it,
  // so no chunk is only overlap.
  let fresh = 0;
  while (first < units.length) {
    // Fill the chunk with whole units up to the target (always at least one new one).
    let end = first;
    let tokens = 0;
    while (end < units.length && (end <= fresh || tokens + units[end]!.tokens <= target)) {
      tokens += units[end]!.tokens;
      end += 1;
    }

    // If more text follows, prefer ending at the last paragraph break past the threshold.
    if (end < units.length && !units[end - 1]!.paragraphEnd) {
      let running = tokens;
      for (let k = end - 1; k > fresh; k -= 1) {
        running -= units[k]!.tokens;
        if (running < target * PARAGRAPH_BREAK_THRESHOLD) break;
        if (units[k - 1]!.paragraphEnd) {
          end = k;
          break;
        }
      }
    }

    const startOffset = units[first]!.start;
    const endOffset = units[end - 1]!.end;
    const content = text.slice(startOffset, endOffset);
    chunks.push({
      content,
      page,
      position: chunks.length,
      tokenCount: countTokens(content),
      startOffset,
      endOffset,
    });

    if (end >= units.length) break;

    // Start the next chunk a few whole units back, so it overlaps this one by ~`overlap`
    // tokens. Leave room for the next new unit, and always move forward by at least one unit.
    const maxOverlap = Math.min(overlap * 2, target - units[end]!.tokens);
    let next = end;
    let overlapped = 0;
    while (
      next - 1 > first &&
      overlapped < overlap &&
      overlapped + units[next - 1]!.tokens <= maxOverlap
    ) {
      overlapped += units[next - 1]!.tokens;
      next -= 1;
    }
    first = next;
    fresh = end;
  }

  return chunks;
}

// Sentences of each paragraph, trimmed, with their offsets. Sentences longer than the target
// are split at whitespace.
function toUnits(text: string, target: number): Unit[] {
  const units: Unit[] = [];

  for (const paragraph of paragraphs(text)) {
    // Single line breaks inside a paragraph are usually just wrapped lines (PDFs especially),
    // and ICU treats them as sentence ends. Segment a copy with them replaced by spaces; it has
    // the same length, so offsets carry over unchanged.
    const flat = text.slice(paragraph.start, paragraph.end).replace(/[\n\r]/g, " ");
    const sentences: { start: number; end: number }[] = [];
    for (const { segment, index } of segmenter.segment(flat)) {
      const span = trimSpan(segment, paragraph.start + index);
      if (span) sentences.push(span);
    }

    sentences.forEach((sentence, i) => {
      const pieces = splitLong(text, sentence.start, sentence.end, target);
      pieces.forEach((piece, j) => {
        units.push({
          ...piece,
          paragraphEnd: i === sentences.length - 1 && j === pieces.length - 1,
        });
      });
    });
  }

  return units;
}

// Paragraphs are separated by blank lines.
function paragraphs(text: string): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  const separator = /\n[ \t]*\n\s*/g;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const span = trimSpan(text.slice(start, match.index), start);
    if (span) result.push(span);
    start = match.index + match[0].length;
  }
  const last = trimSpan(text.slice(start), start);
  if (last) result.push(last);
  return result;
}

function trimSpan(segment: string, offset: number): { start: number; end: number } | null {
  const leading = segment.length - segment.trimStart().length;
  const trimmed = segment.trim();
  if (!trimmed) return null;
  return { start: offset + leading, end: offset + leading + trimmed.length };
}

// Splits [start, end) into pieces of at most ~`target` tokens, at whitespace where possible.
function splitLong(
  text: string,
  start: number,
  end: number,
  target: number,
): { start: number; end: number; tokens: number }[] {
  const tokens = countTokens(text.slice(start, end));
  if (tokens <= target) return [{ start, end, tokens }];

  const pieces: { start: number; end: number; tokens: number }[] = [];
  let pieceStart = -1;
  let pieceEnd = start;
  let pieceTokens = 0;
  const flush = () => {
    if (pieceStart === -1) return;
    pieces.push({ start: pieceStart, end: pieceEnd, tokens: pieceTokens });
    pieceStart = -1;
    pieceTokens = 0;
  };

  for (const word of text.slice(start, end).matchAll(/\S+/g)) {
    const wordStart = start + word.index;
    const wordEnd = wordStart + word[0].length;
    // Approximate: a word costs about what it costs with its leading space.
    const wordTokens = countTokens(` ${word[0]}`);

    if (wordTokens > target) {
      // No whitespace to break at (a URL, a base64 blob…): cut it into fixed-size slices.
      flush();
      const step = target * 3;
      for (let s = wordStart; s < wordEnd; s += step) {
        const e = Math.min(s + step, wordEnd);
        pieces.push({ start: s, end: e, tokens: countTokens(text.slice(s, e)) });
      }
      continue;
    }

    if (pieceStart !== -1 && pieceTokens + wordTokens > target) flush();
    if (pieceStart === -1) pieceStart = wordStart;
    pieceEnd = wordEnd;
    pieceTokens += wordTokens;
  }
  flush();

  return pieces;
}
