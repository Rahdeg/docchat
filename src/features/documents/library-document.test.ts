import { describe, expect, it } from "vitest";

import { readingLabel } from "./library-document";

describe("readingLabel", () => {
  it("says Reading before the page count is known", () => {
    expect(readingLabel({ status: "indexing", pagesRead: 0, pageCount: null })).toBe("Reading");
  });

  it("names the page being read", () => {
    expect(readingLabel({ status: "indexing", pagesRead: 2, pageCount: 9 })).toBe(
      "Reading page 3 of 9",
    );
  });

  it("says Almost ready once every page is read, while chunks are embedded", () => {
    expect(readingLabel({ status: "indexing", pagesRead: 9, pageCount: 9 })).toBe("Almost ready");
  });
});
