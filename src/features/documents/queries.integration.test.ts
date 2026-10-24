import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Hits the real database, so it only runs when DATABASE_URL is set (locally via .env.local).
// CI has no database and skips it. Modules load lazily so CI never validates env or connects.
describe.skipIf(!process.env.DATABASE_URL)("document queries (integration)", () => {
  const alice = `test_alice_${randomUUID()}`;
  const bob = `test_bob_${randomUUID()}`;
  let bobDocumentId: string;

  let queries: typeof import("./queries");
  let dbModule: typeof import("@/server/db");
  let schema: typeof import("@/server/db/schema");

  beforeAll(async () => {
    queries = await import("./queries");
    dbModule = await import("@/server/db");
    schema = await import("@/server/db/schema");

    const base = { mimeType: "text/plain", sizeBytes: 1 };
    const rows = await dbModule.db
      .insert(schema.document)
      .values([
        { ...base, userId: alice, name: "alice-1.txt" },
        { ...base, userId: alice, name: "alice-2.txt" },
        { ...base, userId: bob, name: "bob-1.txt" },
      ])
      .returning();
    bobDocumentId = rows.find((r) => r.userId === bob)!.id;
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    await dbModule.db.delete(schema.document).where(inArray(schema.document.userId, [alice, bob]));
    await dbModule.db.$client.end();
  });

  it("listDocuments returns only the caller's rows", async () => {
    const docs = await queries.listDocuments(alice);

    expect(docs.map((d) => d.name).sort()).toEqual(["alice-1.txt", "alice-2.txt"]);
    expect(docs.map((d) => d.id)).not.toContain(bobDocumentId);
  });

  it("countDocuments counts only the caller's rows", async () => {
    expect(await queries.countDocuments(alice)).toBe(2);
    expect(await queries.countDocuments(bob)).toBe(1);
    expect(await queries.countDocuments(alice, "ready")).toBe(0);
  });

  it("getDocument does not return another user's document", async () => {
    expect(await queries.getDocument(alice, bobDocumentId)).toBeNull();
    expect((await queries.getDocument(bob, bobDocumentId))?.name).toBe("bob-1.txt");
  });
});
