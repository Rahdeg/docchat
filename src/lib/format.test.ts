import { describe, expect, it } from "vitest";

import { formatBytes, formatDate } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1024, "1 KB"],
    [12_408, "12 KB"],
    [482_113, "471 KB"],
    [2_904_511, "2.8 MB"],
  ])("formats %d as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("formats a calendar day without shifting it", () => {
    expect(formatDate("2026-11-15")).toBe("15 Nov 2026");
  });

  it("formats a timestamp in UTC", () => {
    expect(formatDate(new Date("2026-10-21T23:30:00Z"))).toBe("21 Oct 2026");
  });
});
