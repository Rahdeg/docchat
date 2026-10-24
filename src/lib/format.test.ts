import { describe, expect, it } from "vitest";

import { formatBytes, formatDate, formatRelativeTime, plural } from "./format";

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

describe("formatRelativeTime", () => {
  // Local time, like the browser: 24 Oct 2026, 15:00.
  const now = new Date(2026, 9, 24, 15, 0, 0);
  const at = (days: number, hours = 15, minutes = 0, seconds = 0) =>
    new Date(2026, 9, 24 - days, hours, minutes, seconds);

  it.each([
    [at(0, 14, 59, 30), "Just now"],
    [at(0, 14, 15), "45 min ago"],
    [at(0, 0, 5), "Today"],
    [at(1, 23, 59), "Yesterday"],
    [at(3), "3 days ago"],
    [at(8), "Last week"],
    [at(20), "2 weeks ago"],
    [new Date(2026, 6, 2, 9), "2 Jul 2026"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatRelativeTime(value, now)).toBe(expected);
  });

  it("treats a timestamp slightly in the future as just now", () => {
    expect(formatRelativeTime(new Date(now.getTime() + 5000), now)).toBe("Just now");
  });
});

describe("plural", () => {
  it("picks the singular for exactly one", () => {
    expect(plural(1, "page")).toBe("1 page");
    expect(plural(0, "page")).toBe("0 pages");
    expect(plural(62, "passage")).toBe("62 passages");
  });
});
