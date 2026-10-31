import { describe, expect, it } from "vitest";

import { ABOUT_ANSWER } from "@/features/chat/about";

import {
  citedClaims,
  citesPage,
  isAboutReply,
  isHonestNoAnswer,
  share,
  type EvalAnswer,
} from "./answer-metrics";

const lease = (page: number, content: string) => ({ name: "Tenancy agreement.pdf", page, content });

const answer: EvalAnswer = {
  text: "At least **one month's notice** in writing [1]. It can go up once a year [2][1].\n- No pets without consent [3].\nThat's all.",
  noAnswer: false,
  passages: [lease(2, "5.1 Rent."), lease(3, "7.4 Notice."), lease(3, "8.4 Animals.")],
  citations: [
    { number: 1, source: 2, matched: true },
    { number: 2, source: 1, matched: true },
    { number: 3, source: 3, matched: false },
  ],
};

describe("citedClaims", () => {
  it("pairs each cited sentence with each passage it cites", () => {
    expect(citedClaims(answer).map((c) => [c.claim, c.number, c.passage.content])).toEqual([
      ["At least one month's notice in writing.", 1, "7.4 Notice."],
      ["It can go up once a year.", 2, "5.1 Rent."],
      ["It can go up once a year.", 1, "7.4 Notice."],
      ["No pets without consent.", 3, "8.4 Animals."],
    ]);
  });

  it("skips markers with no citation", () => {
    expect(citedClaims({ ...answer, text: "Made up [9]." })).toEqual([]);
  });
});

describe("citesPage", () => {
  it("checks the cited passages' document and page", () => {
    expect(citesPage(answer, "Tenancy agreement.pdf", 3)).toBe(true);
    expect(citesPage(answer, "Tenancy agreement.pdf", 4)).toBe(false);
    expect(citesPage(answer, "Employment contract.pdf", 3)).toBe(false);
  });
});

describe("isHonestNoAnswer", () => {
  const noAnswer = {
    ...answer,
    text: "Your documents don’t say. They cover rent.",
    noAnswer: true,
  };

  it("needs the canned opening and no citations", () => {
    expect(isHonestNoAnswer({ ...noAnswer, citations: [] })).toBe(true);
    expect(isHonestNoAnswer(noAnswer)).toBe(false);
    expect(isHonestNoAnswer({ ...answer, citations: [] })).toBe(false);
  });
});

describe("isAboutReply", () => {
  it("needs the line about DocChat and no citations", () => {
    const about = { text: ABOUT_ANSWER, noAnswer: false, passages: [], citations: [] };

    expect(isAboutReply(about)).toBe(true);
    expect(isAboutReply({ ...about, citations: answer.citations })).toBe(false);
    expect(isAboutReply({ ...answer, citations: [] })).toBe(false);
  });
});

describe("share", () => {
  it("rounds to four places, null when there's nothing to count", () => {
    expect(share(2, 3)).toBe(0.6667);
    expect(share(0, 0)).toBeNull();
  });
});
