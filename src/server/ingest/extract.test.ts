import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { extractPages, IndexingError, messages, normalizeText } from "./extract";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

describe("extractPages", () => {
  it("returns the text of each PDF page and reports progress per page", async () => {
    const onPage = vi.fn();
    const pages = await extractPages(fixture("two-pages.pdf"), "pdf", onPage);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("The rent is 950 pounds a month");
    expect(pages[1]).toContain("notice in writing");
    expect(onPage.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("returns empty pages for a PDF with no text", async () => {
    expect(await extractPages(fixture("no-text.pdf"), "pdf")).toEqual([""]);
  });

  it("explains a damaged PDF", async () => {
    const broken = new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf");

    await expect(extractPages(broken, "pdf")).rejects.toEqual(new IndexingError(messages.damaged));
  });

  it("treats Markdown and text as a single page", async () => {
    const text = new TextEncoder().encode("﻿# Notes\r\n\r\nLine one.\r\nLine two.");

    expect(await extractPages(text, "md")).toEqual(["# Notes\n\nLine one.\nLine two."]);
  });

  it("rejects text that isn't UTF-8", async () => {
    await expect(extractPages(new Uint8Array([0xff, 0xfe, 0x41]), "txt")).rejects.toEqual(
      new IndexingError(messages.notUtf8),
    );
  });
});

describe("normalizeText", () => {
  it("removes NUL and other control characters Postgres or the UI can't use", () => {
    expect(normalizeText("a\u0000b\u0007c\fd")).toBe("abcd");
  });

  it("collapses spaces, keeps line breaks and at most one blank line", () => {
    expect(normalizeText("  one   two \t three \n\n\n\n four  \n five  ")).toBe(
      "one two three\n\nfour\nfive",
    );
  });
});
