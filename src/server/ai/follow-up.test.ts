import { describe, expect, it } from "vitest";

import { readsStandalone } from "./follow-up";

describe("readsStandalone", () => {
  it.each([
    "Can I keep a dog at the property?",
    "How much is the deposit?",
    "What is my annual salary?",
    "Is there a break clause in the tenancy?",
    "Are there any rules about guests staying over?",
    "How many days of paid holiday do I get each year?",
  ])("searches %j as asked", (question) => {
    expect(readsStandalone(question)).toBe(true);
  });

  it.each([
    "And a dog?",
    "What about the deposit?",
    "How much?",
    "Why?",
    "Does it say when they can raise it?",
    "Can I do that without asking?",
    "What does the other document say?",
    "Is the same true for the deposit?",
    "Can I park there overnight?",
    "Also, who pays the council tax?",
  ])("rewrites %j", (question) => {
    expect(readsStandalone(question)).toBe(false);
  });
});
