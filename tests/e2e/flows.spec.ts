import { expect, test, type Page } from "@playwright/test";

import { watchCsp } from "./csp";
import { SAMPLE_NAME, SAMPLE_PDF } from "./paths";

// The signed-in flows, as the e2e user (signed in by auth.setup.ts): upload, a cited answer,
// "Ask about this", the agent's tasks (approve and cancel), the Tasks page by hand, and the
// free-tier limits (docs/adr/0010) last, since they fill the library and the minute's questions.
//
// In CI they run with the fake AI providers and the local file store (docs/adr/0009), so they
// cost nothing. Locally, the steps that call the chat model skip unless CHAT_PROVIDER=fake or
// E2E_LIVE_AI=1: every real call is paid for.
//
// One user, so one file, in order: later steps use the document the first one uploads. Titles
// carry a run id, so reruns against the same account don't trip over earlier rows.
test.describe.configure({ mode: "serial" });

const email = process.env.E2E_CLERK_USER_EMAIL;
const aiAllowed = process.env.CHAT_PROVIDER === "fake" || !!process.env.E2E_LIVE_AI;
const run = Date.now().toString(36);

test.skip(!email, "Set E2E_CLERK_USER_EMAIL to a Clerk development user (…+clerk_test@…)");

function sampleCards(page: Page) {
  return page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^${SAMPLE_NAME}`) }) });
}

async function removeCard(page: Page, cards = sampleCards(page)) {
  // The heading reads "<name>, PDF": the type is for screen readers, not the button's name.
  const heading = (await cards.first().getByRole("heading").first().textContent())?.trim() ?? "";
  const name = heading.includes(", ") ? heading.slice(0, heading.lastIndexOf(", ")) : heading;
  // Pinned by name: the list re-sorts while it polls, so "first" can change under us.
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: new RegExp(`^${escapeRegExp(name)}\\s*,`) }),
  });
  await card.hover();
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The small text files the limit step uploads to fill the library.
const LIMIT_PREFIX = "limit-check-";

function limitCards(page: Page) {
  return page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^${LIMIT_PREFIX}`) }) });
}

async function removeLimitCards(page: Page) {
  while ((await limitCards(page).count()) > 0) {
    const before = await limitCards(page).count();
    await removeCard(page, limitCards(page));
    await expect(limitCards(page)).toHaveCount(before - 1);
  }
}

// Open tasks on /tasks with this exact title.
function openTask(page: Page, title: string) {
  return page.getByRole("checkbox", { name: `Mark done: ${title}`, exact: true });
}

async function openTaskCount(page: Page): Promise<number> {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return page.getByRole("checkbox", { name: /^Mark done: / }).count();
}

async function ask(page: Page, question: string) {
  const box = page.getByRole("textbox", { name: /^Ask about / });
  await expect(box).toBeEditable();
  await box.fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}

// A task request: the fake model proposes one task per must/should sentence it was given.
const TASK_REQUEST = "Make me a checklist of what the Tenant has to do at the end of the tenancy";

test("uploads the sample tenancy agreement and reads it until Ready", async ({ page }) => {
  test.setTimeout(150_000);
  const violations = watchCsp(page);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  // The file input's handler is attached once the page has hydrated.
  await page.waitForLoadState("networkidle");
  // Left over from an earlier run against the same account (the limit step's files too: they'd
  // fill the library).
  while ((await sampleCards(page).count()) > 0) await removeCard(page);
  await removeLimitCards(page);

  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);
  await expect(sampleCards(page)).toHaveCount(1);
  await expect(sampleCards(page).first().getByText("Ready", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  expect(violations()).toEqual([]);
});

test("answers the rent question with a citation, and the source shows the highlight", async ({
  page,
}) => {
  test.skip(!aiAllowed, "Calls the chat model: set CHAT_PROVIDER=fake or E2E_LIVE_AI=1");
  const violations = watchCsp(page);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  // Worded so one sentence (clause 5.1) shares the most words with it: the fake model picks that one.
  await ask(page, "How much is the rent per calendar month?");

  const chip = page.getByRole("button", { name: new RegExp(`^Source 1: ${SAMPLE_NAME}`) });
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await expect(
    page
      .getByRole("main")
      .getByText(/1,150 pounds/)
      .first(),
  ).toBeVisible();

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const sources = page.getByRole("complementary", { name: "Sources" });
  const active = sources.locator('[aria-current="true"]');
  await expect(active.locator("mark")).toContainText("1,150 pounds");

  // The passage's page opens from our own file route, never a raw storage URL.
  const open = active.getByRole("link", { name: /^Open page \d+$/ });
  const href = await open.getAttribute("href");
  expect(href).toMatch(/^\/api\/documents\/[0-9a-f-]{36}\/file#page=\d+$/);
  const file = await page.request.get(href!.split("#")[0]!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(file.headers()["cache-control"]).toBe("private, no-cache");

  expect(violations()).toEqual([]);
});

test("'Ask about this' in the Library opens a chat scoped to that document", async ({ page }) => {
  await page.goto("/library");
  const card = sampleCards(page).first();
  await card.hover();
  // A link styled (and announced) as a button.
  await card.getByRole("button", { name: "Ask about this" }).click();

  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: `Ask about ${SAMPLE_NAME}` })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(SAMPLE_NAME) }).first()).toBeVisible();
});

test("a task request: untick one, add the rest, and they're on /tasks", async ({ page }) => {
  test.skip(!aiAllowed, "Calls the chat model: set CHAT_PROVIDER=fake or E2E_LIVE_AI=1");
  await page.goto("/chat");
  await ask(page, TASK_REQUEST);

  const card = page.getByRole("region", { name: /^Add \d+ tasks? to your list\?$/ });
  await expect(card).toBeVisible({ timeout: 60_000 });
  const ticked = card.getByRole("checkbox", { name: /^Include: /, checked: true });
  expect(await ticked.count()).toBeGreaterThanOrEqual(2);

  const titleOf = async (box: ReturnType<typeof ticked.nth>) =>
    (await box.getAttribute("aria-label"))!.replace(/^Include: /, "");
  const dropped = await titleOf(ticked.first());
  const droppedBefore = await (async () => {
    const tasksPage = await page.context().newPage();
    const count = await openTaskCount(tasksPage).then(() => openTask(tasksPage, dropped).count());
    await tasksPage.close();
    return count;
  })();

  await card.getByRole("checkbox", { name: `Include: ${dropped}`, exact: true }).click();
  const kept: string[] = [];
  for (const box of await ticked.all()) kept.push(await titleOf(box));
  expect(kept).not.toContain(dropped);

  const tasks = kept.length === 1 ? "task" : "tasks";
  await card.getByRole("button", { name: `Add ${kept.length} ${tasks}`, exact: true }).click();
  await expect(
    page.getByText(`Added ${kept.length} ${tasks}. See them on the Tasks page.`),
  ).toBeVisible();

  await openTaskCount(page);
  for (const title of kept) await expect(openTask(page, title).first()).toBeVisible();
  await expect(openTask(page, dropped)).toHaveCount(droppedBefore);
});

test("cancelling a task request saves nothing", async ({ page }) => {
  test.skip(!aiAllowed, "Calls the chat model: set CHAT_PROVIDER=fake or E2E_LIVE_AI=1");
  const before = await openTaskCount(page);

  await page.goto("/chat");
  await ask(page, TASK_REQUEST);
  const card = page.getByRole("region", { name: /^Add \d+ tasks? to your list\?$/ });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("No tasks were added.")).toBeVisible();

  expect(await openTaskCount(page)).toBe(before);
});

test("adds, ticks, edits and deletes a task by hand", async ({ page }) => {
  const title = `Book the check-out inspection ${run}`;
  const renamed = `Book the check-out inspection with the clerk ${run}`;
  await openTaskCount(page);

  await page.getByRole("textbox", { name: "New task" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(openTask(page, title)).toBeVisible();

  // Ticked: it moves under "Show N done"; unticked, it's back.
  await openTask(page, title).click();
  await expect(openTask(page, title)).toBeHidden();
  await page.getByRole("button", { name: /^Show \d+ done$/ }).click();
  const done = page.getByRole("checkbox", { name: `Mark not done: ${title}`, exact: true });
  await expect(done).toBeVisible();
  await done.click();
  await expect(openTask(page, title)).toBeVisible();

  await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Task title" });
  await editor.fill(renamed);
  await editor.press("Enter");
  await expect(openTask(page, renamed)).toBeVisible();
  await expect(openTask(page, title)).toHaveCount(0);

  await page.getByRole("button", { name: `More actions for ${renamed}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(openTask(page, renamed)).toHaveCount(0);
  await expect(page.getByText(`Deleted "${renamed}"`)).toBeVisible();

  // Still gone after a reload: the delete was saved.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await expect(openTask(page, renamed)).toHaveCount(0);
});

// Free-tier limits (docs/adr/0010), with the defaults: 3 documents, 5 questions a minute. The
// daily allowances (30 questions, 5 task requests) would stop reruns on the same day, so CI's
// e2e job raises those two; run locally with the same QUESTIONS_PER_DAY and AGENT_RUNS_PER_DAY.

test("at 3 documents the upload button is off and says why, and a 4th file shows the toast", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await removeLimitCards(page);

  const cards = page.getByRole("article");
  const have = await cards.count();
  test.skip(have > 3, "The e2e user has more than 3 documents from elsewhere");
  const upload = page.getByRole("button", { name: "Upload files" }).first();
  if (have > 0 && have < 3) {
    await expect(upload).toBeEnabled();
    await expect(page.getByText(`${have} of 3 documents`).first()).toBeVisible();
  }

  // Fill the library with small, different text files (the same file twice is a duplicate).
  const files = Array.from({ length: 3 - have }, (_, i) => ({
    name: `${LIMIT_PREFIX}${i}-${run}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`Limit check ${i} for run ${run}. The Tenant must water the plants.`),
  }));
  if (files.length > 0) await page.locator('input[type="file"]').setInputFiles(files);
  await expect(cards).toHaveCount(3, { timeout: 60_000 });

  // At the limit: disabled, but still focusable and described by a visible note.
  const note = "You've reached the free limit of 3 documents. Delete one to upload another.";
  await expect(upload).toBeDisabled();
  await expect(upload).toHaveAccessibleDescription(note);
  await expect(page.getByText(note).first()).toBeVisible();

  // A 4th file (dropped or picked anyway) is refused with the toast and its action.
  await page.locator('input[type="file"]').setInputFiles({
    name: `${LIMIT_PREFIX}extra-${run}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`One too many, run ${run}.`),
  });
  const toast = page.locator('[data-limit="DOCUMENT_LIMIT"]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(note);
  await expect(toast.getByRole("link", { name: "Open library" })).toBeVisible();
  await expect(cards).toHaveCount(3);

  // Dismissed, it's gone (it would otherwise cover the cards' hover actions).
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toBeHidden();

  // Deleting one frees a slot.
  await removeLimitCards(page);
  await expect(upload).toBeEnabled();
});

test("asking past the per-minute limit says how long to wait", async ({ page }) => {
  test.skip(!aiAllowed, "Calls the chat model: set CHAT_PROVIDER=fake (CI) or E2E_LIVE_AI=1");
  test.setTimeout(120_000);
  await page.goto("/chat");
  await expect(page.getByRole("textbox", { name: /^Ask about / })).toBeEditable();

  // Earlier steps may have used some of this minute's 5 questions: ask until refused.
  const toast = page.locator('[data-limit="QUESTIONS_PER_MINUTE"]');
  let asked = 0;
  // After the first answer the composer reads "Ask a follow-up".
  const box = page.getByRole("textbox", { name: /^Ask / });
  for (; asked < 7 && !(await toast.isVisible()); asked += 1) {
    await expect(box).toBeEditable();
    await box.fill(`What is the rent, quick question ${asked} ${run}?`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 60_000 });
    // A refusal's toast follows the response.
    await toast.waitFor({ timeout: 2_000 }).catch(() => {});
  }

  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(/You're asking quickly\. Try again in \d+ seconds?\./);
  // The refused question is back in the composer, ready to send when the wait is over.
  await expect(box).toHaveValue(new RegExp(`quick question \\d+ ${run}`));
});
