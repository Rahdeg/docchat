import { describe, expect, it } from "vitest";

import { asksForTasks, mentionsDuties, TURN_INTO_TASKS } from "./task-request";

describe("asksForTasks", () => {
  it.each([
    "Turn my tenancy agreement into a move-in checklist",
    "What are my deadlines?",
    "what are my deadlines in my employment contract?",
    "List my coursework deadlines",
    "Make tasks from the syllabus",
    "Add a to-do for the deposit",
    "Give me a todo list",
    "What are the action items?",
    "List the action points from the letter",
    "Remind me to return the inventory",
    "What are my next steps?",
    "What should I do before I move in?",
    "What do I need to do this week?",
    "Can you make a list of what to pay?",
    TURN_INTO_TASKS,
  ])("offers the tools for %j", (question) => {
    expect(asksForTasks(question)).toBe(true);
  });

  it.each([
    "How much is the deposit?",
    "When can the landlord increase the rent?",
    "Can I keep a bicycle in the hallway?",
    "What is the notice period after probation?",
    "Who are you?",
  ])("answers %j as a plain question", (question) => {
    expect(asksForTasks(question)).toBe(false);
  });

  it("matches curly apostrophes and any case", () => {
    expect(asksForTasks("WHAT DO I NEED TO DO?")).toBe(true);
  });
});

describe("mentionsDuties", () => {
  it.each([
    "The Tenant **must** return the inventory signed [1].",
    "Rent is due on the first day of each month [1].",
    "You need to give four weeks' written notice [1].",
    "Return it within 7 days of the start date [1].",
    "The first payment covers 1 March 2026 to 31 March 2026 [1].",
    "The draft is due on 7/11/2026.",
  ])("offers 'Turn this into tasks' under %j", (answer) => {
    expect(mentionsDuties(answer)).toBe(true);
  });

  it.each([
    "The deposit is 1,326 pounds [1].",
    "Your documents don't say anything about that.",
    "Bicycles may be kept in the communal bike store [1].",
  ])("doesn't offer it under %j", (answer) => {
    expect(mentionsDuties(answer)).toBe(false);
  });
});
