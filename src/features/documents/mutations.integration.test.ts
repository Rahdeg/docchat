import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The document limit's binding check against the real database: counting and inserting happen
// under a per-user lock, so concurrent uploads can't overshoot. Runs only with DATABASE_URL;
// modules load lazily so CI never connects.
describe.skipIf(!process.env.DATABASE_URL)("document limit (integration)", () => {
  const alice = `test_alice_${randomUUID()}`;

  let mutations: typeof import("./mutations");
  let dbModule: typeof import("@/server/db");
  let schema: typeof import("@/server/db/schema");
  let orm: typeof import("drizzle-orm");

  const upload = (name: string) => ({
    name,
    mimeType: "text/plain",
    sizeBytes: 1,
    blobPathname: `users/${alice}/${randomUUID()}-${name}`,
  });

  async function documentsOf(userId: string) {
    return dbModule.db.$count(schema.document, orm.eq(schema.document.userId, userId));
  }

  beforeAll(async () => {
    mutations = await import("./mutations");
    dbModule = await import("@/server/db");
    schema = await import("@/server/db/schema");
    orm = await import("drizzle-orm");
  });

  beforeEach(async () => {
    await dbModule.db.delete(schema.document).where(orm.eq(schema.document.userId, alice));
  });

  afterAll(async () => {
    await dbModule.db.delete(schema.document).where(orm.eq(schema.document.userId, alice));
    await dbModule.db.$client.end();
  });

  it("lets exactly one of two simultaneous uploads take the last slot", async () => {
    await mutations.createDocument(alice, upload("one.txt"), 3);
    await mutations.createDocument(alice, upload("two.txt"), 3);

    const results = await Promise.all([
      mutations.createDocument(alice, upload("three-a.txt"), 3),
      mutations.createDocument(alice, upload("three-b.txt"), 3),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, max: 3 }]);
    expect(await documentsOf(alice)).toBe(3);
  });

  it("holds under a larger burst too", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => mutations.createDocument(alice, upload(`${i}.txt`), 3)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await documentsOf(alice)).toBe(3);
  });

  it("frees a slot when a document is deleted, and counts every state", async () => {
    const first = await mutations.createDocument(alice, upload("one.txt"), 2);
    const second = await mutations.createDocument(alice, upload("two.txt"), 2);
    if (!first.ok || !second.ok) throw new Error("setup failed");
    // A failed document still takes a slot.
    await dbModule.db
      .update(schema.document)
      .set({ status: "failed" })
      .where(orm.eq(schema.document.id, second.document.id));

    expect((await mutations.createDocument(alice, upload("three.txt"), 2)).ok).toBe(false);
    await mutations.deleteDocument(alice, first.document.id);
    expect((await mutations.createDocument(alice, upload("three.txt"), 2)).ok).toBe(true);
  });

  it("returns the existing row for a double submit, even at the limit", async () => {
    const values = upload("one.txt");
    const created = await mutations.createDocument(alice, values, 1);

    const again = await mutations.createDocument(alice, values, 1);

    expect(again).toEqual(created);
    expect(await documentsOf(alice)).toBe(1);
  });

  it("has no limit for an unlimited user (null)", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await mutations.createDocument(alice, upload(`${i}.txt`), null)).ok).toBe(true);
    }
  });
});
