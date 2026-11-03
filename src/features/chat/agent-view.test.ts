import { describe, expect, it } from "vitest";

import type { Proposal } from "./agent-parts";
import {
  agentSteps,
  approvedTasks,
  dueButtonLabel,
  initialChoices,
  proposalState,
  taskMeta,
  textAround,
} from "./agent-view";
import type { ChatUIMessage, PassageData } from "./message";

const passage = (n: number, name: string): PassageData => ({
  chunkId: `00000000-0000-4000-8000-00000000000${n}`,
  documentId: "11111111-1111-4111-8111-111111111111",
  name,
  mimeType: "application/pdf",
  hasFile: true,
  page: 1,
  content: "text",
  startOffset: 0,
  endOffset: 4,
  similarity: 0.8,
});

const task = (title: string, optional = false): Proposal["tasks"][number] => ({
  title,
  dueDate: null,
  dueNote: null,
  dateDropped: false,
  optional,
  source: 1,
  citation: 1,
  quote: "q",
  start: 0,
  end: 4,
  matched: false,
  label: null,
});

const proposal: Proposal = {
  toolCallId: "call_1",
  rejected: 0,
  tasks: [task("Pay the deposit"), task("Get insurance", true)],
};

function answer(state: "approval-requested" | "output-available" | "output-denied") {
  const tool =
    state === "output-available"
      ? { state, output: { added: 1 }, approval: { id: "a", approved: true as const } }
      : state === "output-denied"
        ? { state, approval: { id: "a", approved: false as const } }
        : { state, approval: { id: "a" } };
  return {
    parts: [
      {
        type: "data-passages",
        id: "passages",
        data: {
          query: "q",
          passages: [passage(1, "Tenancy agreement.pdf"), passage(2, "Tenancy agreement.pdf")],
        },
      },
      { type: "text", text: "Here's what I found." },
      {
        type: "tool-proposeTasks",
        toolCallId: "call_1",
        input: { tasks: [] as never[] },
        ...tool,
      },
      { type: "data-proposal", id: "proposal", data: proposal },
      ...(state === "output-available"
        ? [{ type: "text", text: "Added 1 task. See them on the Tasks page." }]
        : []),
    ],
  } as unknown as Pick<ChatUIMessage, "parts">;
}

describe("agentSteps", () => {
  it("reads like the design while waiting", () => {
    expect(agentSteps(answer("approval-requested"), false).map((s) => s.label)).toEqual([
      "Read 2 passages from Tenancy agreement",
      "Picked out 2 things to do",
      "Waiting for you to check them",
    ]);
  });

  it("says what happened once answered", () => {
    expect(agentSteps(answer("output-available"), false).at(-1)?.label).toBe(
      "Added 1 task to your list",
    );
    expect(agentSteps(answer("output-denied"), false).at(-1)?.label).toBe(
      "Cancelled: nothing was added",
    );
  });
});

describe("proposalState", () => {
  it("waits only once the checked proposal is in", () => {
    const { parts } = answer("approval-requested");
    const part = parts.find((p) => p.type === "tool-proposeTasks") as never;
    expect(proposalState(part, null)).toBe("checking");
    expect(proposalState(part, proposal)).toBe("waiting");
    expect(proposalState(null, proposal)).toBe("checking");
  });
});

describe("the card's choices", () => {
  it("starts optional tasks unticked and sends the ticked ones by index", () => {
    const choices = initialChoices(proposal);
    expect(choices.map((c) => c.included)).toEqual([true, false]);
    expect(approvedTasks([{ ...choices[0]!, title: "  Pay it  " }, choices[1]!])).toEqual([
      { index: 0, title: "Pay it", dueDate: null },
    ]);
  });

  it("never sends a task whose title was cleared", () => {
    expect(approvedTasks([{ included: true, title: "  ", dueDate: null }])).toEqual([]);
  });
});

describe("labels", () => {
  it("words the date button from the due note", () => {
    expect(dueButtonLabel("2026-11-01", "before the start date", "2026-11-03")).toBe(
      "Before 1 Nov",
    );
    expect(dueButtonLabel("2026-11-08", "within 7 days of moving in", "2026-11-03")).toBe(
      "By 8 Nov",
    );
    expect(dueButtonLabel("2026-11-01", null, "2026-11-03")).toBe("1 Nov");
  });

  it("puts the clause, the deadline and 'advised' under the title", () => {
    expect(taskMeta({ ...task("x", true), label: "clause 10.1", dueNote: "within 7 days" })).toBe(
      "Clause 10.1, within 7 days, advised, not required",
    );
  });
});

describe("textAround", () => {
  it("splits the model's text from the line after the proposal", () => {
    expect(textAround(answer("output-available"))).toEqual({
      before: "Here's what I found.",
      after: "Added 1 task. See them on the Tasks page.",
    });
  });
});
