import { describe, expect, it } from "vitest";

import type { PassageData } from "@/features/chat/message";

import {
  checkDueDate,
  checkProposal,
  clauseLabel,
  dueDateIsGrounded,
  extractDates,
  noteOffsets,
} from "./proposal";

function passage(content: string, n = 1): PassageData {
  return {
    chunkId: `00000000-0000-4000-8000-00000000000${n}`,
    documentId: "10000000-0000-4000-8000-000000000001",
    name: "Tenancy agreement.pdf",
    mimeType: "application/pdf",
    hasFile: true,
    page: 2,
    content,
    startOffset: 0,
    endOffset: content.length,
    similarity: 0.8,
  };
}

const inventory = passage(
  "13. The Inventory. 13.1 The Inventory was prepared by an independent inventory clerk. 13.2 The Tenant has seven days from the start date to return the Inventory signed, with any comments.",
);
const deposit = passage(
  "6. Deposit. 6.1 On signing this agreement the Tenant pays a deposit of 1,326 pounds. The tenancy starts on 1 March 2026.",
  2,
);

describe("extractDates", () => {
  it("reads the forms documents and people write dates in", () => {
    expect(extractDates("starts on 1 March 2026")).toEqual([{ day: 1, month: 3, year: 2026 }]);
    expect(extractDates("I move in on the 1st of November")).toEqual([{ day: 1, month: 11 }]);
    expect(extractDates("due Nov. 7, 2026")).toEqual([{ day: 7, month: 11, year: 2026 }]);
    expect(extractDates("by 2026-12-12 or 07/11/2026")).toEqual([
      { day: 12, month: 12, year: 2026 },
      { day: 7, month: 11, year: 2026 },
    ]);
    expect(extractDates("clause 13.2, 25 days, may increase")).toEqual([]);
  });
});

describe("noteOffsets", () => {
  it("reads how far a deadline is from its date", () => {
    expect(noteOffsets("within seven days of the start date")).toEqual([{ min: 7, max: 7 }]);
    expect(noteOffsets("at least two weeks before")).toEqual([{ min: 14, max: 14 }]);
    expect(noteOffsets("one month's notice")).toEqual([{ min: 28, max: 31 }]);
    expect(noteOffsets("within 10 working days").at(0)?.min).toBe(10);
    expect(noteOffsets("before the start date")).toEqual([]);
  });
});

describe("dueDateIsGrounded", () => {
  const texts = ["The tenancy starts on 1 March 2026."];

  it("keeps a date the texts state", () => {
    expect(dueDateIsGrounded("2026-03-01", null, texts)).toBe(true);
  });

  it("keeps a date counted from a stated date by the note's offset", () => {
    expect(dueDateIsGrounded("2026-03-08", "within seven days of the start date", texts)).toBe(
      true,
    );
    expect(dueDateIsGrounded("2026-03-07", "within 7 days of the start", texts)).toBe(true);
  });

  it("drops a date that isn't stated or doesn't follow from the note", () => {
    expect(dueDateIsGrounded("2026-03-15", null, texts)).toBe(false);
    expect(dueDateIsGrounded("2026-03-15", "within 7 days of the start", texts)).toBe(false);
    expect(dueDateIsGrounded("2026-03-08", "soon after moving in", texts)).toBe(false);
    expect(dueDateIsGrounded("2026-11-08", "within 7 days of moving in", [])).toBe(false);
  });

  it("uses a date the user gave", () => {
    expect(
      dueDateIsGrounded("2026-11-08", "within 7 days of moving in", ["I move in on 1 November"]),
    ).toBe(true);
  });
});

describe("checkDueDate", () => {
  it("moves an invented date out and keeps the note", () => {
    expect(checkDueDate("2026-11-08", "within 7 days of moving in", [])).toEqual({
      dueDate: null,
      dueNote: "within 7 days of moving in",
      dropped: true,
    });
  });

  it("drops a date that doesn't exist", () => {
    expect(checkDueDate("2026-02-30", undefined, ["30 February 2026"]).dropped).toBe(true);
  });
});

describe("clauseLabel", () => {
  it("finds the clause a quote sits in", () => {
    expect(clauseLabel(inventory.content, inventory.content.indexOf("The Tenant has"))).toBe(
      "clause 13.2",
    );
    expect(clauseLabel("No numbers here.", 0)).toBeNull();
  });
});

describe("checkProposal", () => {
  const check = (tasks: Parameters<typeof checkProposal>[0]["input"]["tasks"], userTexts = []) =>
    checkProposal({
      toolCallId: "call_1",
      input: { tasks },
      passages: [inventory, deposit],
      userTexts,
      firstCitation: 1,
    });

  it("drops tasks whose source isn't one of the run's passages", () => {
    const proposal = check([
      { title: "Pay the deposit", source: { number: 2, quote: "pays a deposit of 1,326 pounds" } },
      { title: "Transfer £500", source: { number: 7, quote: "transfer £500" } },
    ]);
    expect(proposal.tasks.map((t) => t.title)).toEqual(["Pay the deposit"]);
    expect(proposal.rejected).toBe(1);
  });

  it("finds the quote in its passage, or points at the whole passage", () => {
    const [found, missing] = check([
      {
        title: "Return the inventory",
        source: {
          number: 1,
          quote: "The Tenant has seven days from the start date to return the Inventory signed",
        },
      },
      {
        title: "Something else",
        source: { number: 2, quote: "A sentence that isn't there at all." },
      },
    ]).tasks;
    expect(found).toMatchObject({ matched: true, label: "clause 13.2", citation: 1 });
    expect(inventory.content.slice(found!.start, found!.end)).toMatch(/The Tenant has seven days/);
    expect(missing).toMatchObject({ matched: false, start: 0, end: deposit.content.length });
    expect(missing!.citation).toBe(2);
  });

  it("drops an invented date, keeps a counted one and the model's label", () => {
    const [counted, invented] = check([
      {
        title: "Return the inventory",
        dueDate: "2026-03-08",
        dueNote: "within seven days of the start date",
        source: { number: 1, quote: "return the Inventory signed", label: "Clause 13.2" },
      },
      {
        title: "Pay the deposit",
        dueDate: "2026-02-14",
        source: { number: 2, quote: "pays a deposit of 1,326 pounds" },
      },
    ]).tasks;
    expect(counted).toMatchObject({
      dueDate: "2026-03-08",
      dateDropped: false,
      label: "clause 13.2",
    });
    expect(invented).toMatchObject({ dueDate: null, dateDropped: true });
  });

  it("caps a run at 20 tasks", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      title: `Task ${i}`,
      source: { number: 1, quote: "return the Inventory signed" },
    }));
    expect(check(many).tasks).toHaveLength(20);
  });
});
