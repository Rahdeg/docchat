import { expect, test, type Page } from "@playwright/test";

import { watchCsp } from "./csp";
import { SAMPLE_NAME, SAMPLE_PDF } from "./paths";

// The signed-in flows, as the e2e user (signed in by auth.setup.ts): upload, a cited answer,
// "Ask about this", the agent's tasks (approve and cancel) and the Tasks page by hand.
//
// In CI they run with the fake AI providers and the local file store (docs/adr/0009), so they
// cost no AI quota. Locally, the steps that call the chat model skip unless CHAT_PROVIDER=fake
// or E2E_LIVE_AI=1: the Gemini free tier allows 20 requests a day.
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

async function removeCard(page: Page) {
  const card = sampleCards(page).first();
  await card.hover();
  await card.getByRole("button", { name: `More actions for ${SAMPLE_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
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
  // Left over from an earlier run against the same account.
  while ((await sampleCards(page).count()) > 0) await removeCard(page);

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
