import { describe, expect, it, vi } from "vitest";

import {
  CitationFilter,
  matchQuote,
  parseCitationBlock,
  QUOTE_MIN_SIMILARITY,
  resolveCitations,
} from "./citations";

const clause =
  "7.3 Any increase applies from the next rent payment date after the notice period ends. " +
  "7.4 The Landlord must give the Tenant not less than one month’s notice in writing of any " +
  "rent increase, stating the new rent and the date it takes effect. 7.5 If a notice does not " +
  "follow this clause, the Tenant may write to the Landlord asking for it to be withdrawn.";

const sentence74 =
  "7.4 The Landlord must give the Tenant not less than one month’s notice in writing of any " +
  "rent increase, stating the new rent and the date it takes effect.";

function highlighted(text: string, quote: string) {
  const match = matchQuote(text, quote);
  return match && text.slice(match.start, match.end);
}

describe("matchQuote", () => {
  it("finds an exact quote", () => {
    const match = matchQuote(clause, sentence74);

    expect(match?.similarity).toBe(1);
    expect(clause.slice(match!.start, match!.end)).toBe(sentence74);
  });

  it("ignores case, straight versus curly quotes, and wrapped lines", () => {
    const quote =
      "7.4 the landlord must give the tenant not less than one month's notice\n in writing of any " +
      "rent increase, stating the new rent and the date it takes effect.";

    expect(highlighted(clause, quote)).toBe(sentence74);
  });

  it("strips quotation marks and an ellipsis around the quote", () => {
    expect(highlighted(clause, `"…must give the Tenant not less than one month’s notice"`)).toBe(
      "must give the Tenant not less than one month’s notice",
    );
  });

  it("accepts minor differences, widened to whole words", () => {
    // Two words changed and one dropped, as models do when they paraphrase a little.
    const quote =
      "The Landlord must give the Tenant no less than one month's notice in writing of a rent " +
      "increase, stating the new rent and the date it takes effect.";

    const match = matchQuote(clause, quote);

    expect(match).not.toBeNull();
    expect(match!.similarity).toBeGreaterThanOrEqual(QUOTE_MIN_SIMILARITY);
    expect(match!.similarity).toBeLessThan(1);
    expect(clause.slice(match!.start, match!.end)).toMatch(
      /^7\.4 The Landlord must give .* takes effect\.$/,
    );
  });

  it("takes in the clause number in front of the quoted sentence", () => {
    expect(
      highlighted(clause, "The Landlord must give the Tenant not less than one month’s notice"),
    ).toBe("7.4 The Landlord must give the Tenant not less than one month’s notice");
  });

  it("rejects a quote that isn't in the passage", () => {
    expect(matchQuote(clause, "The Tenant must not keep any animal at the Property.")).toBeNull();
  });

  it("rejects a paraphrase too far from the text", () => {
    expect(
      matchQuote(clause, "Your landlord has to warn you a month ahead in writing."),
    ).toBeNull();
  });

  it("rejects an empty quote", () => {
    expect(matchQuote(clause, '""')).toBeNull();
  });
});

describe("parseCitationBlock", () => {
  it("reads one JSON object per line", () => {
    const block = `
{"source": 2, "quote": "7.4 The Landlord must give notice."}
{"source": 1, "quote": "Rent is due monthly."}
</citations>`;

    expect(parseCitationBlock(block)).toEqual([
      { source: 2, quote: "7.4 The Landlord must give notice." },
      { source: 1, quote: "Rent is due monthly." },
    ]);
  });

  it("reads a JSON array in a code fence, and skips invalid entries", () => {
    const block = '```json\n[{"source": "3", "quote": "Yes."}, {"source": 1}, {"quote": "x"}]\n```';

    expect(parseCitationBlock(block)).toEqual([{ source: 3, quote: "Yes." }]);
  });

  it("returns nothing for garbage", () => {
    expect(parseCitationBlock("I cited sources 1 and 2.")).toEqual([]);
  });
});

// Feeds `chunks` through a filter as a stream would and returns what the browser sees.
function run(chunks: string[], sourceCount = 5, onCite?: (order: readonly number[]) => void) {
  const filter = new CitationFilter({ sourceCount, onCite });
  let shown = "";
  for (const chunk of chunks) shown += filter.push(chunk);
  shown += filter.flush();
  return { filter, shown };
}

// Splits text into chunks of `size` characters, to cut markers and tags at every point.
function pieces(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe("CitationFilter", () => {
  const raw =
    "At least one month's notice in writing [4]. It can only go up once a year [2], and the " +
    "notice must follow the clause [4][5].\n\n<citations>\n" +
    '{"source": 4, "quote": "one month’s notice"}\n{"source": 2, "quote": "once"}\n</citations>';

  it("renumbers chips in order of first appearance and hides the citations block", () => {
    const { filter, shown } = run([raw]);

    expect(shown).toBe(
      "At least one month's notice in writing [1]. It can only go up once a year [2], and the " +
        "notice must follow the clause [1][3].",
    );
    expect(filter.order).toEqual([4, 2, 5]);
    expect(filter.text).toBe(shown);
    expect(parseCitationBlock(filter.block)).toHaveLength(2);
  });

  it.each([1, 2, 3, 5, 7])(
    "gives the same result when the stream is cut every %i characters",
    (size) => {
      expect(run(pieces(raw, size)).shown).toBe(run([raw]).shown);
    },
  );

  it("never shows part of a marker or of the citations tag", () => {
    const filter = new CitationFilter({ sourceCount: 5 });
    const seen = [
      filter.push("The rent is 1,150 pounds a month "),
      filter.push("[1"),
      filter.push("]. Done.\n\n<cita"),
    ];

    expect(seen).toEqual(["The rent is 1,150 pounds a month", "", " [1]. Done."]);
    expect(filter.push('tions>{"source":1,"quote":"x"}')).toBe("");
  });

  it("drops a marker for a source that wasn't retrieved, and the space before it", () => {
    const { filter, shown } = run(["Pets need consent [9]. Rent is monthly [2]."], 3);

    expect(shown).toBe("Pets need consent. Rent is monthly [1].");
    expect(filter.dropped).toEqual([9]);
    expect(filter.order).toEqual([2]);
  });

  it("splits a list marker into chips and keeps the valid ones", () => {
    expect(run(["Both apply [3, 1, 7]."], 3).shown).toBe("Both apply [1][2].");
  });

  it("leaves brackets that aren't markers alone", () => {
    expect(run(["See clause [7.4] and [sic]."]).shown).toBe("See clause [7.4] and [sic].");
  });

  it("drops every marker from a 'don't say' answer", () => {
    const { filter, shown } = run([
      "Your docu",
      "ments don’t say. They cover rent [1] and pets [2].",
    ]);

    expect(shown).toBe("Your documents don’t say. They cover rent and pets.");
    expect(filter.noAnswer).toBe(true);
    expect(filter.order).toEqual([]);
  });

  it("reports each newly cited source as it streams", () => {
    const onCite = vi.fn();

    run(["A [2]. ", "B [2]. ", "C [1]."], 3, onCite);

    expect(onCite.mock.calls).toEqual([[[2]], [[2, 1]]]);
  });
});

describe("resolveCitations", () => {
  const passages = [
    { content: "5.1 The rent is 1,150 pounds per calendar month, payable in advance." },
    { content: clause },
    { content: "8.4 The Tenant must not keep any animal at the Property without consent." },
  ];

  it("highlights the quoted sentence in each cited passage, in citation order", () => {
    const { citations, dropped } = resolveCitations({
      order: [2, 1],
      quotes: [
        { source: 1, quote: "The rent is 1,150 pounds per calendar month" },
        { source: 2, quote: sentence74 },
      ],
      passages,
    });

    expect(dropped).toEqual([]);
    expect(citations.map((c) => [c.number, c.source, c.matched])).toEqual([
      [1, 2, true],
      [2, 1, true],
    ]);
    expect(clause.slice(citations[0]!.start, citations[0]!.end)).toBe(sentence74);
  });

  it("keeps a citation whose quote isn't in its passage, highlighting the whole passage", () => {
    // The quote is real, but from another passage: it's only looked for in the cited one.
    const { citations } = resolveCitations({
      order: [1],
      quotes: [{ source: 1, quote: "The Tenant must not keep any animal at the Property" }],
      passages,
    });

    expect(citations).toEqual([
      {
        number: 1,
        source: 1,
        quote: "The Tenant must not keep any animal at the Property",
        start: 0,
        end: passages[0]!.content.length,
        matched: false,
      },
    ]);
  });

  it("highlights the whole passage when the model gave no quote", () => {
    const { citations } = resolveCitations({ order: [3], quotes: [], passages });

    expect(citations[0]).toMatchObject({ quote: null, start: 0, matched: false });
  });

  it("tries each quote given for a source", () => {
    const { citations } = resolveCitations({
      order: [3],
      quotes: [
        { source: 3, quote: "Something else entirely, not in the text at all." },
        { source: 3, quote: "must not keep any animal" },
      ],
      passages,
    });

    expect(citations[0]).toMatchObject({ quote: "must not keep any animal", matched: true });
  });

  it("drops quotes for sources that weren't retrieved", () => {
    const { citations, dropped } = resolveCitations({
      order: [1],
      quotes: [
        { source: 1, quote: "The rent is 1,150 pounds" },
        { source: 7, quote: "Made up." },
      ],
      passages,
    });

    expect(citations).toHaveLength(1);
    expect(dropped).toEqual([{ source: 7, quote: "Made up." }]);
  });
});
