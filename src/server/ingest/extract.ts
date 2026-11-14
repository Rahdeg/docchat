import "server-only";

import { getDocumentProxy } from "unpdf";

import type { FileKind } from "@/features/documents/upload-rules";
import { limitMessage } from "@/lib/limit-messages";

// A failure the user can act on. Its message is shown in the Library as is.
export class IndexingError extends Error {
  override name = "IndexingError";
}

export const messages = {
  noText: "No text found. Scanned PDFs aren't supported yet.",
  empty: "This file is empty.",
  encrypted: "This PDF is password-protected. Remove the password and upload it again.",
  damaged: "This PDF looks damaged. Try saving it again and re-uploading.",
  notUtf8: "This file isn't plain UTF-8 text.",
  missing: "We couldn't find the uploaded file. Remove it and upload it again.",
  generic: "Something went wrong while reading this file. Try again.",
} as const;

type OnPage = (pagesRead: number, pageCount: number) => Promise<void> | void;

type ExtractOptions = {
  // Runs after each page, for progress.
  onPage?: OnPage;
  // A PDF with more pages stops here, before any text is read (MAX_PAGES_PER_DOCUMENT).
  maxPages?: number;
};

// Text of each page, normalised (see normalizeText). Markdown and text files are one page.
export async function extractPages(
  bytes: Uint8Array,
  kind: FileKind,
  { onPage, maxPages }: ExtractOptions = {},
): Promise<string[]> {
  if (kind !== "pdf") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      throw new IndexingError(messages.notUtf8);
    }
    await onPage?.(1, 1);
    return [normalizeText(text)];
  }

  // unpdf ships a serverless build of pdf.js with the worker inlined and no native deps, so it
  // runs on Vercel's Node runtime without bundler or worker-path setup.
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may detach the buffer it's given; pass a copy so callers keep theirs.
    pdf = await getDocumentProxy(bytes.slice());
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new IndexingError(name === "PasswordException" ? messages.encrypted : messages.damaged);
  }

  try {
    if (maxPages !== undefined && pdf.numPages > maxPages) {
      throw new IndexingError(
        limitMessage({ code: "TOO_MANY_PAGES", max: maxPages, pages: pdf.numPages }),
      );
    }
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("");
      pages.push(normalizeText(text));
      page.cleanup();
      await onPage?.(number, pdf.numPages);
    }
    return pages;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// The stored page text, which chunk offsets point into. Postgres text can't hold NUL bytes, so
// control characters go; line breaks are kept (single ones are wrapped lines, blank lines are
// paragraph breaks) and runs of spaces collapse.
export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
