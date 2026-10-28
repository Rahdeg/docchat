import { describe, expect, it } from "vitest";

import { inline, parseAnswer, plainAnswer } from "./answer-markup";

describe("parseAnswer", () => {
  it("splits paragraphs, joins wrapped lines, and reads bold and citation markers", () => {
    expect(
      parseAnswer(
        "At least **one month's notice**\nin writing [1].\n\nIt can rise once a year [2].",
      ),
    ).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "At least " },
          { type: "bold", text: "one month's notice" },
          { type: "text", text: " in writing " },
          { type: "cite", number: 1 },
          { type: "text", text: "." },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "It can rise once a year " },
          { type: "cite", number: 2 },
          { type: "text", text: "." },
        ],
      },
    ]);
  });

  it("reads a list after a paragraph", () => {
    const blocks = parseAnswer("You need:\n- written notice [1]\n- the new rent [1][2]");

    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list"]);
    expect(blocks[1]).toEqual({
      type: "list",
      items: [
        [
          { type: "text", text: "written notice " },
          { type: "cite", number: 1 },
        ],
        [
          { type: "text", text: "the new rent " },
          { type: "cite", number: 1 },
          { type: "cite", number: 2 },
        ],
      ],
    });
  });

  it("ignores empty text", () => {
    expect(parseAnswer("\n\n  \n")).toEqual([]);
  });
});

describe("inline", () => {
  it("hides an unclosed ** while the answer streams", () => {
    expect(inline("At least **one mon")).toEqual([{ type: "text", text: "At least one mon" }]);
  });

  it("leaves HTML as text", () => {
    expect(inline("<b>hi</b>")).toEqual([{ type: "text", text: "<b>hi</b>" }]);
  });
});

describe("plainAnswer", () => {
  it("drops bold markers and markers with no source", () => {
    expect(plainAnswer("**One month** [1], not two [3].", (n) => (n === 1 ? "Lease" : null))).toBe(
      "One month [1], not two.",
    );
  });
});
