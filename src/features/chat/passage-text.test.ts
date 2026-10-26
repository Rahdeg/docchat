import { describe, expect, it } from "vitest";

import { bestSentence, excerpt, sentences } from "./passage-text";

const rentPassage =
  "7.3 Any increase applies from the next rent payment date after notice is given. " +
  "7.4 The Landlord must give the Tenant not less than one month's notice in writing of any " +
  "rent increase, stating the new rent and the date it takes effect. 7.5 If a notice does not " +
  "follow this clause, the Tenant may write to the Landlord asking for it to be withdrawn.";

describe("sentences", () => {
  it("doesn't split at wrapped lines", () => {
    const text = "The rent is due\non the first day. Pay by transfer.";
    expect(sentences(text).map((s) => text.slice(s.start, s.end))).toEqual([
      "The rent is due\non the first day.",
      "Pay by transfer.",
    ]);
  });
});

describe("bestSentence", () => {
  it("picks the sentence sharing the most words with the question", () => {
    const span = bestSentence(
      rentPassage,
      "How much notice does my landlord need to give before raising the rent?",
    );
    expect(rentPassage.slice(span!.start, span!.end)).toMatch(/^7\.4 The Landlord must give/);
  });

  it("matches simple word forms", () => {
    const text = "Pets are not allowed. Repairs are the landlord's job.";
    const span = bestSentence(text, "who repairs things");
    expect(text.slice(span!.start, span!.end)).toBe("Repairs are the landlord's job.");
  });

  it("returns null when no sentence shares a word", () => {
    expect(bestSentence(rentPassage, "parking permits")).toBeNull();
    expect(bestSentence(rentPassage, "what is the")).toBeNull();
  });
});

describe("excerpt", () => {
  it("keeps a short passage whole", () => {
    const span = { start: 4, end: 9 };
    expect(excerpt("The quick fox.", span)).toEqual({
      before: "The ",
      mark: "quick",
      after: " fox.",
      cutStart: false,
      cutEnd: false,
    });
  });

  it("trims a long passage around the highlight, at spaces", () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const start = words.indexOf("w100");
    const end = words.indexOf("w110") - 1;

    const result = excerpt(words, { start, end }, 120);

    expect(result.mark).toBe(words.slice(start, end));
    expect(result.cutStart).toBe(true);
    expect(result.cutEnd).toBe(true);
    expect(result.before.length).toBeLessThan(result.after.length);
    expect(result.before + result.mark + result.after).toMatch(/^w\d+ .* w\d+$/);
    expect((result.before + result.mark + result.after).length).toBeLessThanOrEqual(120);
  });

  it("trims from the start when there's no highlight", () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");

    const result = excerpt(words, null, 50);

    expect(result).toMatchObject({ mark: "", after: "", cutStart: false, cutEnd: true });
    expect(result.before.startsWith("w0 w1")).toBe(true);
    expect(result.before.length).toBeLessThanOrEqual(50);
  });

  it("uses the room after a highlight near the end for text before it", () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const start = words.indexOf("w98");

    const result = excerpt(words, { start, end: words.length }, 60);

    expect(result.cutEnd).toBe(false);
    expect(result.cutStart).toBe(true);
    expect((result.before + result.mark).length).toBeGreaterThan(40);
  });
});
