import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Hits the real database, so it only runs when DATABASE_URL is set (locally via .env.local).
describe.skipIf(!process.env.DATABASE_URL)("task mutations (integration)", () => {
  const alice = `test_alice_${randomUUID()}`;
  const bob = `test_bob_${randomUUID()}`;
  let bobTaskId: string;
  let bobDocumentId: string;

  let mutations: typeof import("./mutations");
  let queries: typeof import("./queries");
  let dbModule: typeof import("@/server/db");
  let schema: typeof import("@/server/db/schema");

  beforeAll(async () => {
    mutations = await import("./mutations");
    queries = await import("./queries");
    dbModule = await import("@/server/db");
    schema = await import("@/server/db/schema");

    const [doc] = await dbModule.db
      .insert(schema.document)
      .values({ userId: bob, name: "bob.txt", mimeType: "text/plain", sizeBytes: 1 })
      .returning();
    bobDocumentId = doc!.id;
    bobTaskId = (await mutations.createTask(bob, { title: "Bob's task", dueDate: null })).id;
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    await dbModule.db.delete(schema.task).where(inArray(schema.task.userId, [alice, bob]));
    await dbModule.db.delete(schema.document).where(inArray(schema.document.userId, [alice, bob]));
    await dbModule.db.$client.end();
  });

  it("can't change, tick or delete another user's task", async () => {
    expect(await mutations.updateTask(alice, bobTaskId, { title: "Mine now" })).toBe(false);
    expect(await mutations.setTaskDone(alice, bobTaskId, true)).toBe(false);
    expect(await mutations.deleteTask(alice, bobTaskId)).toBeNull();

    const [bobs] = await queries.listTasks(bob);
    expect(bobs).toMatchObject({ title: "Bob's task", done: false });
    expect(await queries.listTasks(alice)).toEqual([]);
  });

  it("sets and clears completedAt with done", async () => {
    const { id } = await mutations.createTask(alice, { title: "Pay rent", dueDate: "2026-11-08" });

    await mutations.setTaskDone(alice, id, true);
    expect((await queries.listTasks(alice))[0]?.completedAt).not.toBeNull();
    expect(await queries.countOpenTasks(alice)).toBe(0);

    await mutations.setTaskDone(alice, id, false);
    expect((await queries.listTasks(alice))[0]?.completedAt).toBeNull();
    await mutations.deleteTask(alice, id);
  });

  it("restores a deleted task, dropping links to rows that aren't the user's", async () => {
    const { id } = await mutations.createTask(alice, { title: "Read clause 4", dueDate: null });
    const deleted = await mutations.deleteTask(alice, id);
    expect(deleted).not.toBeNull();

    const { userId: _owner, ...snapshot } = deleted!;
    expect(
      await mutations.restoreTask(alice, { ...snapshot, sourceDocumentId: bobDocumentId }),
    ).toBe(true);
    const [restored] = await queries.listTasks(alice);
    expect(restored).toMatchObject({ id, title: "Read clause 4", source: null });

    // Restoring twice doesn't duplicate it.
    expect(await mutations.restoreTask(alice, snapshot)).toBe(false);
  });
});
