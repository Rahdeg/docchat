import { describe, expect, it } from "vitest";

import { chatTitle, isNoAnswer } from "./message";

describe("chatTitle", () => {
  it("keeps a short question as it is, on one line", () => {
    expect(chatTitle("  Can I keep\n a cat?  ")).toBe("Can I keep a cat?");
  });

  it("cuts a long question at a word, about 60 characters in", () => {
    const title = chatTitle(
      "How much notice does my landlord need to give before raising the rent on my flat?",
    );

    expect(title).toBe("How much notice does my landlord need to give before raising…");
    expect(title.length).toBeLessThanOrEqual(61);
  });

  it("cuts a single long word", () => {
    expect(chatTitle("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
  });
});

describe("isNoAnswer", () => {
  it("recognises the canned opening, with either apostrophe", () => {
    expect(isNoAnswer("Your documents don't say. They cover rent.")).toBe(true);
    expect(isNoAnswer("  Your documents don’t say anything about cars.")).toBe(true);
    expect(isNoAnswer("Your documents say the rent is 1,150 pounds [1].")).toBe(false);
  });
});
