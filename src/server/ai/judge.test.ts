import { describe, expect, it } from "vitest";

import { parseVerdict } from "./judge";

describe("parseVerdict", () => {
  it("reads JSON, in a code fence or with text around it", () => {
    expect(parseVerdict('{"supported": true, "reason": "Clause 7.4 says so."}')).toEqual({
      supported: true,
      reason: "Clause 7.4 says so.",
    });
    expect(parseVerdict('Sure.\n```json\n{"supported": false, "reason": "No."}\n```')).toEqual({
      supported: false,
      reason: "No.",
    });
  });

  it("throws on an empty, cut-off or wrongly shaped reply", () => {
    expect(() => parseVerdict("")).toThrow();
    expect(() => parseVerdict('```json\n{"supported": tr')).toThrow();
    expect(() => parseVerdict('{"supported": "yes", "reason": "x"}')).toThrow();
  });
});
