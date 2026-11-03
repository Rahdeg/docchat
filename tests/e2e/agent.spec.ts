import { test } from "@playwright/test";

// TODO(e2e): the Tasks and agent flows. Like the signed-in Library flow (documents.spec.ts), they
// need a Clerk test user and testing tokens (@clerk/testing), which aren't set up yet, and the
// agent flow needs a chat model (or a mocked /api/chat) and fixtures in the test user's Library.
// Listed as fixme so they show as pending in the report.

test.describe("Tasks page", () => {
  test.fixme("adds a task with and without a date, grouped, and the sidebar count goes up", () => {});
  test.fixme("ticks a task under 'Show N done' and unticks it; the count follows", () => {});
  test.fixme("edits a title in place (Enter saves, Escape cancels), changes and clears a date", () => {});
  test.fixme("deletes a task and restores it with Undo, source link intact", () => {});
  test.fixme("opens an agent task's source with the quote highlighted (popover, phone sheet)", () => {});
  test.fixme("To do / Done / All counts and the documents filter", () => {});
});

test.describe("Agent", () => {
  test.fixme("a move-in checklist request shows the steps and 'Add N tasks to your list?'", () => {});
  test.fixme("untick one, edit a title, set a date: 'Add N tasks' follows the ticks", () => {});
  test.fixme("Add: the fixed line links to /tasks, which lists them with working sources", () => {});
  test.fixme("Cancel: 'No tasks were added.' and /tasks is unchanged", () => {});
  test.fixme("a double click on Add adds the tasks once", () => {});
  test.fixme("a card's source chip selects its passage in the Sources panel", () => {});
  test.fixme("phone: the sticky bar replaces the composer; unticked suggestions fold away", () => {});
  test.fixme("'Turn this into tasks' under a deadline answer sends that request", () => {});
});
