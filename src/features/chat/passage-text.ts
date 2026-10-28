// Text helpers for showing a passage: which sentence to highlight, and how to trim a long
// passage around it. Pure, so the client and tests can use them.

export type Span = { start: number; end: number };

// Common words that say nothing about what the question is about.
const stopwords = new Set(
  (
    "a about after again all also am an and any are as at be because been before being but by " +
    "can could did do does doing for from had has have having he her here his how i if in into " +
    "is it its just me more most my no not of on once only or other our out over own same she " +
    "should so some such than that the their them then there these they this those through to " +
    "too under until up very was we were what when where which while who whom why will with " +
    "would you your yours much many need needs give get got make made say said tell"
  ).split(" "),
);

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// Lower-cased content words with simple English endings removed, so "raising" and "raise",
// "notices" and "notice" match.
function terms(text: string): Set<string> {
  const result = new Set<string>();
  for (const [word] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if (word.length < 3 || stopwords.has(word)) continue;
    result.add(stem(word));
  }
  return result;
}

function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s", "ly"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

// Sentences of the passage, trimmed, as offsets into it. Line breaks inside the passage are
// usually wrapped lines (PDFs), so they don't end a sentence.
export function sentences(passage: string): Span[] {
  const flat = passage.replace(/[\n\r]/g, " ");
  const spans: Span[] = [];
  for (const { segment, index } of sentenceSegmenter.segment(flat)) {
    const leading = segment.length - segment.trimStart().length;
    const trimmed = segment.trim();
    if (trimmed) spans.push({ start: index + leading, end: index + leading + trimmed.length });
  }
  return spans;
}

// The sentence sharing the most words with the query, or null when none shares any. Ties go
// to the earlier sentence.
export function bestSentence(passage: string, query: string): Span | null {
  const wanted = terms(query);
  if (wanted.size === 0) return null;

  let best: Span | null = null;
  let bestScore = 0;
  for (const span of sentences(passage)) {
    const have = terms(passage.slice(span.start, span.end));
    let score = 0;
    for (const term of wanted) if (have.has(term)) score += 1;
    if (score > bestScore) {
      best = span;
      bestScore = score;
    }
  }
  return best;
}

export type Excerpt = {
  before: string;
  // The highlighted text, empty when there is no highlight.
  mark: string;
  after: string;
  // Text was cut at the start or end; show an ellipsis there.
  cutStart: boolean;
  cutEnd: boolean;
};

// Characters a full-size card shows of a passage before trimming it.
export const EXCERPT_CHARS = 420;

// Trims a long passage to about `maxChars`, keeping the whole highlight and some context on
// each side (more after it than before), cutting at spaces.
export function excerpt(
  passage: string,
  highlight: Span | null,
  maxChars = EXCERPT_CHARS,
): Excerpt {
  const span = highlight ?? { start: 0, end: 0 };
  let start = 0;
  let end = passage.length;

  if (passage.length > maxChars) {
    const room = Math.max(0, maxChars - (span.end - span.start));
    let before = Math.min(span.start, Math.floor(room / 3));
    const after = Math.min(passage.length - span.end, room - before);
    // Give room the end can't use back to the start.
    before = Math.min(span.start, room - after);
    start = cutAtSpace(passage, span.start - before, "forward", span.start);
    end = cutAtSpace(passage, span.end + after, "back", span.end);
  }

  return {
    before: passage.slice(start, span.start === span.end ? end : span.start),
    mark: passage.slice(span.start, span.end),
    after: span.start === span.end ? "" : passage.slice(span.end, end),
    cutStart: start > 0,
    cutEnd: end < passage.length,
  };
}

// Moves `at` to the nearest word boundary inside the kept text, never past `limit`.
function cutAtSpace(text: string, at: number, direction: "forward" | "back", limit: number) {
  if (at <= 0) return 0;
  if (at >= text.length) return text.length;
  if (direction === "forward") {
    const space = text.indexOf(" ", at);
    return space === -1 || space >= limit ? at : space + 1;
  }
  const space = text.lastIndexOf(" ", at);
  return space === -1 || space <= limit ? at : space;
}
