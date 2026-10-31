import "server-only";

import { z } from "zod";

import { isNoAnswer, NO_ANSWER_PREFIX, type Citation } from "@/features/chat/message";

// Citations (docs/adr/0006). The model writes its answer with [n] markers, n being a source's
// number in the prompt, and then a block listing the sentence it relied on for each source:
//
//   … the date it takes effect [2].
//
//   <citations>
//   {"source": 2, "quote": "The Landlord must give the Tenant not less than one month's …"}
//   </citations>
//
// While the answer streams, CitationFilter hides the block and renumbers the markers 1, 2, 3 in
// order of first appearance, dropping any that point at a source that wasn't retrieved. When
// it's done, resolveCitations finds each quote in its passage.

export const CITATIONS_OPEN = "<citations>";
export const CITATIONS_CLOSE = "</citations>";

// [3], [1, 2] or [1,2]. Digits and commas only, so "[sic]" and "[7.4]" stay text.
const MARKER = /( ?)\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
// The start of a marker that may still be streaming: "[", "[1", "[1, ".
const PARTIAL_MARKER = /\[[\d\s,]{0,16}$/;

type FilterOptions = {
  // Sources in the prompt, numbered 1..sourceCount.
  sourceCount: number;
  // Called when a source is cited for the first time, with every cited source so far in
  // citation order (so the browser can show a chip's source while the answer streams).
  onCite?: (order: readonly number[]) => void;
};

// Cleans the model's text as it streams: push() each delta and send what it returns, then
// flush() at the end of a text part. What it returns is safe to show; text that might be the
// start of a marker or of the citations block is held back until the next delta decides.
export class CitationFilter {
  // Cited sources (prompt numbers) in order of first appearance. Chip k is order[k - 1].
  readonly order: number[] = [];
  // Markers pointing at a source number that wasn't in the prompt.
  readonly dropped: number[] = [];
  // Everything returned so far: the answer as the browser shows it.
  text = "";
  // The answer starts with NO_ANSWER_PREFIX, so its markers are dropped.
  noAnswer = false;

  private pending = "";
  private decided = false;
  private inBlock = false;
  private blockText = "";

  constructor(private readonly options: FilterOptions) {}

  // The raw citations block, once the model has written it.
  get block(): string {
    return this.blockText;
  }

  push(delta: string): string {
    if (this.inBlock) {
      this.blockText += delta;
      return "";
    }
    this.pending += delta;
    if (!this.decided) {
      // Hold the opening back until it's clear whether it's the "don't say" answer.
      const start = this.pending.trimStart().replace(/[‘’]/g, "'");
      if (start.length < NO_ANSWER_PREFIX.length && NO_ANSWER_PREFIX.startsWith(start)) return "";
      this.decided = true;
      this.noAnswer = isNoAnswer(this.pending);
    }
    return this.drain(false);
  }

  // End of a text part: release what was held back, except trailing whitespace.
  flush(): string {
    if (this.inBlock) return "";
    this.decided = true;
    this.noAnswer ||= isNoAnswer(this.pending);
    return this.drain(true);
  }

  private drain(final: boolean): string {
    const open = this.pending.toLowerCase().indexOf(CITATIONS_OPEN);
    if (open !== -1) {
      this.blockText = this.pending.slice(open + CITATIONS_OPEN.length);
      this.inBlock = true;
      const before = this.pending.slice(0, open).trimEnd();
      this.pending = "";
      return this.emit(before);
    }

    let cut = this.pending.length;
    if (final) {
      cut = this.pending.trimEnd().length;
    } else {
      const tag = partialSuffix(this.pending, CITATIONS_OPEN);
      const marker = this.pending.match(PARTIAL_MARKER);
      if (tag !== null) cut = tag;
      else if (marker?.index !== undefined) cut = marker.index;
      // Whitespace may come right before the block, which is dropped with it.
      while (cut > 0 && /\s/.test(this.pending[cut - 1]!)) cut -= 1;
    }
    const ready = this.pending.slice(0, cut);
    this.pending = final ? "" : this.pending.slice(cut);
    return this.emit(ready);
  }

  private emit(text: string): string {
    const before = this.order.length;
    const out = text.replace(MARKER, (_match, space: string, list: string) => {
      const numbers: number[] = [];
      for (const source of list.split(",").map((n) => Number(n.trim()))) {
        if (this.noAnswer) continue;
        if (!Number.isInteger(source) || source < 1 || source > this.options.sourceCount) {
          this.dropped.push(source);
          continue;
        }
        if (!this.order.includes(source)) this.order.push(source);
        const number = this.order.indexOf(source) + 1;
        if (!numbers.includes(number)) numbers.push(number);
      }
      return numbers.length > 0 ? space + numbers.map((n) => `[${n}]`).join("") : "";
    });
    if (this.order.length > before) this.options.onCite?.([...this.order]);
    this.text += out;
    return out;
  }
}

// Where a suffix of `text` starts that is a prefix of `tag` (ignoring case), or null.
function partialSuffix(text: string, tag: string): number | null {
  const lower = text.toLowerCase();
  for (let length = Math.min(tag.length - 1, lower.length); length > 0; length -= 1) {
    if (tag.startsWith(lower.slice(lower.length - length))) return lower.length - length;
  }
  return null;
}

const quoteLineSchema = z.object({
  source: z.coerce.number().int(),
  quote: z.string().trim().min(1),
});

export type ModelQuote = z.infer<typeof quoteLineSchema>;

// The model's citations block: one JSON object per line, or a JSON array of them. Lines that
// aren't valid are skipped; a citation without a quote highlights its whole passage.
export function parseCitationBlock(block: string): ModelQuote[] {
  const body = block
    .split(new RegExp(CITATIONS_CLOSE, "i"))[0]!
    .replace(/```(?:json)?/g, "")
    .trim();
  const parsed = tryJson(body);
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : [...body.matchAll(/\{[^{}]*\}/g)].map((match) => tryJson(match[0]));
  return items.flatMap((item) => {
    const result = quoteLineSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type ResolveInput = {
  // CitationFilter.order: cited sources in citation order.
  order: readonly number[];
  quotes: readonly ModelQuote[];
  // The passages in prompt order: source n is passages[n - 1].
  passages: readonly { content: string }[];
};

export type Resolved = {
  citations: Citation[];
  // Quotes for a source that wasn't in the prompt.
  dropped: ModelQuote[];
};

// One citation per cited source, numbered in citation order, highlighting the sentence the
// model quoted. When the quote can't be found in that passage (it's only looked for there), the
// citation stays and highlights the whole passage. Quotes for sources the answer doesn't cite
// are ignored; quotes for sources that weren't retrieved are returned in `dropped`.
export function resolveCitations({ order, quotes, passages }: ResolveInput): Resolved {
  const dropped = quotes.filter((q) => q.source < 1 || q.source > passages.length);
  const citations = order.map((source, index): Citation => {
    const content = passages[source - 1]!.content;
    const candidates = quotes.filter((q) => q.source === source);
    for (const { quote } of candidates) {
      const match = matchQuote(content, quote);
      if (match) {
        return {
          number: index + 1,
          source,
          quote,
          start: match.start,
          end: match.end,
          matched: true,
        };
      }
    }
    const quote = candidates[0]?.quote ?? null;
    return { number: index + 1, source, quote, start: 0, end: content.length, matched: false };
  });
  return { citations, dropped };
}

// How close a quote must be to the passage text: 1 - edit distance / quote length.
export const QUOTE_MIN_SIMILARITY = 0.85;
// Longer quotes aren't a sentence; highlighting the whole passage is as useful.
const QUOTE_MAX_CHARS = 1_200;

export type QuoteMatch = { start: number; end: number; similarity: number };

// Finds `quote` in `text`, as offsets into `text`. Case, runs of whitespace (wrapped PDF lines),
// curly versus straight quotes and dash styles don't count as differences. An exact match
// wins; otherwise the closest substring by edit distance, if it's at least
// QUOTE_MIN_SIMILARITY similar. Null when nothing is close enough.
export function matchQuote(text: string, quote: string): QuoteMatch | null {
  const target = normalize(text);
  const wanted = normalize(stripWrapping(quote)).text;
  if (wanted.length === 0 || wanted.length > QUOTE_MAX_CHARS) return null;

  const exact = target.text.indexOf(wanted);
  if (exact !== -1) return toOriginal(text, target.map, exact, exact + wanted.length, 1);

  const best = closestSubstring(target.text, wanted);
  const similarity = 1 - best.distance / wanted.length;
  if (similarity < QUOTE_MIN_SIMILARITY) return null;
  return toOriginal(text, target.map, best.start, best.end, similarity);
}

// Quotation marks or an ellipsis the model put around the sentence.
function stripWrapping(quote: string): string {
  return quote
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .replace(/^(?:\.{3}|…)\s*|\s*(?:\.{3}|…)$/g, "")
    .trim();
}

type Normalized = {
  text: string;
  // map[i] is the index in the original of normalized character i.
  map: number[];
};

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
};
const DASHES = /[‐‑‒–—―−]/;

function normalize(text: string): Normalized {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (/\s/.test(char)) {
      if (out.length > 0 && !out.endsWith(" ")) {
        out += " ";
        map.push(i);
      }
      continue;
    }
    const mapped = QUOTES[char] ?? (DASHES.test(char) ? "-" : char.toLowerCase());
    for (const c of mapped) {
      out += c;
      map.push(i);
    }
  }
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

// Normalized [start, end) back to the original, widened to whole words.
function toOriginal(
  text: string,
  map: number[],
  start: number,
  end: number,
  similarity: number,
): QuoteMatch {
  let from = map[start]!;
  let to = map[end - 1]! + 1;
  const word = /[\p{L}\p{N}]/u;
  for (let n = 0; n < 12 && from > 0 && word.test(text[from - 1]!) && word.test(text[from]!); n++) {
    from -= 1;
  }
  for (
    let n = 0;
    n < 12 && to < text.length && word.test(text[to]!) && word.test(text[to - 1]!);
    n++
  ) {
    to += 1;
  }
  // Take in the clause number in front of a quoted clause ("7.4 The Landlord must…").
  const number = text.slice(Math.max(0, from - 12), from).match(/(?:^|\s)(\d+(?:\.\d+)+\s+)$/);
  if (number) from -= number[1]!.length;
  return { start: from, end: to, similarity };
}

// Approximate substring search (Sellers): the substring of `text` with the smallest edit
// distance to `pattern`. O(pattern × text): a few million steps for a sentence in a chunk.
function closestSubstring(text: string, pattern: string) {
  const n = text.length;
  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  // Where the alignment ending at each column starts in `text`.
  let prevStart = Int32Array.from({ length: n + 1 }, (_, j) => j);
  let curStart = new Int32Array(n + 1);

  for (let i = 1; i <= pattern.length; i += 1) {
    cur[0] = i;
    curStart[0] = 0;
    const p = pattern.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      let best = prev[j - 1]! + (p === text.charCodeAt(j - 1) ? 0 : 1);
      let start = prevStart[j - 1]!;
      if (prev[j]! + 1 < best) {
        best = prev[j]! + 1;
        start = prevStart[j]!;
      }
      if (cur[j - 1]! + 1 < best) {
        best = cur[j - 1]! + 1;
        start = curStart[j - 1]!;
      }
      cur[j] = best;
      curStart[j] = start;
    }
    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
  }

  let end = 0;
  for (let j = 1; j <= n; j += 1) if (prev[j]! < prev[end]!) end = j;
  return { start: prevStart[end]!, end: Math.max(end, prevStart[end]! + 1), distance: prev[end]! };
}
