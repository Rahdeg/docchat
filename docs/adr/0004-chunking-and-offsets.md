# ADR 0004: Chunk size, overlap and per-page character offsets

- Status: Accepted
- Date: 2026-10-24

## Context

Answers cite the passages they come from (ADR 0003 stores the vectors). To retrieve passages, each
uploaded document is split into chunks that are embedded and searched. Two things depend on how we
split:

- **Retrieval quality.** Chunks that are too small lose context; chunks that are too large blur
  several topics into one vector and fill the prompt with text that doesn't answer the question.
- **Citations.** A citation should point to an exact place in the document: the page, and the
  sentence the answer quoted, so the UI can highlight it. A chunk's text alone isn't enough to find
  that place again; the same sentence can appear more than once, and extraction normalises
  whitespace.

## Decision

**Size and overlap.** Chunks are about **500 tokens** (cl100k, the tokenizer of OpenAI's
1536-dimension embedding models), with **about 15% (75 tokens) overlap** between neighbours.

- 500 tokens is a few paragraphs: enough context for a clause, a policy section or a syllabus week,
  small enough that one chunk is usually about one thing, and cheap to put several in a prompt.
- The overlap repeats the end of one chunk at the start of the next, so a sentence near a boundary
  is retrievable with its context from either side.

**Boundaries.** The chunker (`src/server/ai/chunk.ts`, a pure function) works in whole sentences:

- Pages are split into paragraphs at blank lines, then into sentences with `Intl.Segmenter`.
  Single line breaks are treated as wrapped lines (common in PDF text), not sentence ends.
- A chunk takes whole sentences up to the target. Once it is at least 60% full (counting its
  overlap), it ends at a paragraph break rather than running into the middle of the next
  paragraph.
- Overlap is whole sentences stepped back from the end of the previous chunk, capped so the next
  new sentence always fits. Every chunk includes at least one sentence the previous one didn't.
- Only a sentence longer than the target is split, at whitespace (or in fixed slices if it has
  none, like a long URL).
- Chunks never cross pages, so each chunk has exactly one page.

**Offsets.** Each chunk stores `page`, `startOffset` and `endOffset`: character offsets into that
page's text, so `pageText.slice(startOffset, endOffset) === content`. The page text is stored in
`document_page` (one row per page, `pageNumber`, `text`), written in the same transaction as the
chunks. Markdown and text files are a single page.

Unit tests hold the chunker to these rules: exact slices, full coverage of every page, overlap of
roughly 15%, and no sentence cut in the middle when it doesn't need to be.

## Why character offsets per page

- **Citations resolve to an exact location.** A citation is (document, page, start, end). The UI
  can show the page and the surrounding text, and later jump to the spot in the original file.
- **Highlighting the quoted sentence.** When an answer quotes part of a chunk, the UI finds the
  quote inside `pageText.slice(startOffset, endOffset)` and highlights exactly that span, even when
  the same words appear elsewhere on the page.
- **Stable under re-chunking.** Offsets point into stored page text, not into other chunks. If we
  change the chunk size later, old citations still resolve against the page.
- **Per page, not per document.** Offsets stay small and meaningful ("page 4, characters 120–480"),
  and a page can be loaded on its own without reassembling the whole document.

## Alternatives considered

- **Fixed-size character windows.** Simple, but they cut sentences and words in half, which hurts
  both embeddings and the quotes shown to users.
- **Storing only chunk text and searching for it later.** Fragile: repeated sentences, and
  normalisation differences between the chunk and the original, make the match ambiguous.
- **Storing page text in Blob instead of Postgres.** Keeps the database smaller, but every citation
  would need a Blob fetch, and pages would no longer cascade-delete or branch with the database.

## Indexing runs in `after()` for now

Indexing (download, extract, chunk, store) runs in `after()` on the Library page's function,
limited by that page's `maxDuration` (300 s). It isn't durable: if the function times out or
crashes, a document stays `indexing`. The Library treats `uploaded`/`indexing` documents with no
progress for 10 minutes as stuck ("Reading stopped") and offers **Try again**, which re-indexes from
scratch (old pages and chunks are deleted in the same transaction as the new ones are written).

A later PR should move indexing to a durable queue (for example Inngest or Vercel Queues) with
retries, and drop the stuck-document workaround.

## When we would revisit

- Retrieval evaluation shows answers missing context (larger chunks or more overlap) or diluted by
  irrelevant text (smaller chunks).
- We switch to an embedding model with a different tokenizer or context length.
- We add document types with structure worth following (headings, tables, slides), where splitting
  by section beats splitting by sentence.
