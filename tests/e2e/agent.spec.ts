import { test } from "@playwright/test";

// The Tasks and agent flows that flows.spec.ts doesn't cover yet. flows.spec.ts has the main
// ones (a task request approved with one task unticked, cancel saves nothing, a task added,
// ticked, edited and deleted by hand), with the fake chat model in CI. Listed as fixme so they
// show as pending in the report.

test.describe("Tasks page", () => {
  test.fixme("adds a task with a date, grouped under its day, and the sidebar count goes up", () => {});
  test.fixme("edits a title in place: Escape cancels; changes and clears a date", () => {});
  test.fixme("deletes a task and restores it with Undo, source link intact", () => {});
  test.fixme("opens an agent task's source with the quote highlighted (popover, phone sheet)", () => {});
  test.fixme("To do / Done / All counts and the documents filter", () => {});
});

test.describe("Agent", () => {
  test.fixme("edit a title and set a date on the card: 'Add N tasks' follows the ticks", () => {});
  test.fixme("a double click on Add adds the tasks once", () => {});
  test.fixme("a card's source chip selects its passage in the Sources panel", () => {});
  test.fixme("phone: the sticky bar replaces the composer; unticked suggestions fold away", () => {});
  test.fixme("'Turn this into tasks' under a deadline answer sends that request", () => {});
});
