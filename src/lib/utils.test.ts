import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("drops falsy values and honours object syntax", () => {
    const isActive = false;
    expect(
      cn("base", isActive && "active", undefined, null, { "is-on": true, "is-off": false }),
    ).toBe("base is-on");
  });

  it("resolves conflicting Tailwind classes, last one wins", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("bg-primary text-sm", "bg-highlight")).toBe("text-sm bg-highlight");
  });
});
