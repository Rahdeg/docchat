import { afterAll, describe, expect, it, vi } from "vitest";

// Imported lazily: CI has no database. Blob is stubbed; this checks the rows.
vi.mock("./blob", () => ({ deleteBlobsWithPrefix: vi.fn(async () => 0) }));

const gone = `user_testDeleted${process.pid}`;
const kept = `user_testKept${process.pid}`;

describe.skipIf(!process.env.DATABASE_URL)("deleteUserData", { timeout: 60_000 }, () => {
  async function load() {
    const { deleteUserData } = await import("./account");
    const { deleteBlobsWithPrefix } = await import("./blob");
    const { db } = await import("./db");
    const schema = await import("./db/schema");
    const { eq, inArray } = await import("drizzle-orm");
    return { deleteUserData, deleteBlobsWithPrefix, db, schema, eq, inArray };
  }

  // A document with a page and a chunk, a chat with a message, a task linked to all of them, a
  // usage row and a rate-limit event.
  async function seed(userId: string) {
    const { db, schema } = await load();
    const [doc] = await db
      .insert(schema.document)
      .values({
        userId,
        name: "Lease.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        status: "ready",
      })
      .returning();
    await db
      .insert(schema.documentPage)
      .values({ userId, documentId: doc!.id, pageNumber: 1, text: "Pay the deposit." });
    const [chunkRow] = await db
      .insert(schema.chunk)
      .values({
        userId,
        documentId: doc!.id,
        content: "Pay the deposit.",
        page: 1,
        position: 0,
        tokenCount: 4,
        startOffset: 0,
        endOffset: 16,
        embedding: Array.from({ length: 1536 }, () => 0.01),
        embeddingModel: "test/model",
      })
      .returning();
    const [chatRow] = await db.insert(schema.chat).values({ userId, title: "Deposit" }).returning();
    await db
      .insert(schema.message)
      .values({ userId, chatId: chatRow!.id, role: "user", parts: [{ type: "text", text: "Hi" }] });
    await db.insert(schema.task).values({
      userId,
      title: "Pay the deposit",
      createdBy: "agent",
      chatId: chatRow!.id,
      sourceDocumentId: doc!.id,
      sourceChunkId: chunkRow!.id,
    });
    await db
      .insert(schema.aiUsage)
      .values({ userId, kind: "embed-query", model: "test/model", tokens: 3 });
    await db.insert(schema.rateLimitEvent).values({ userId, bucket: "search" });
  }

  async function counts(userId: string) {
    const { db, schema, eq } = await load();
    const tables = {
      tasks: schema.task,
      messages: schema.message,
      chats: schema.chat,
      chunks: schema.chunk,
      pages: schema.documentPage,
      documents: schema.document,
      aiUsage: schema.aiUsage,
      rateLimits: schema.rateLimitEvent,
    };
    const result: Record<string, number> = {};
    for (const [name, table] of Object.entries(tables)) {
      result[name] = await db.$count(table, eq(table.userId, userId));
    }
    return result;
  }

  afterAll(async () => {
    const { deleteUserData } = await load();
    await deleteUserData(gone);
    await deleteUserData(kept);
  });

  it("deletes every row of the user's in one go, and nobody else's", async () => {
    const { deleteUserData, deleteBlobsWithPrefix } = await load();
    await seed(gone);
    await seed(kept);

    const { rows } = await deleteUserData(gone);

    expect(rows).toEqual({
      tasks: 1,
      messages: 1,
      chats: 1,
      chunks: 1,
      pages: 1,
      documents: 1,
      aiUsage: 1,
      rateLimits: 1,
    });
    expect(Object.values(await counts(gone)).every((n) => n === 0)).toBe(true);
    expect(Object.values(await counts(kept)).every((n) => n === 1)).toBe(true);
    expect(deleteBlobsWithPrefix).toHaveBeenCalledWith(`users/${gone}/`);
  });

  it("does nothing the second time", async () => {
    const { deleteUserData } = await load();

    const { rows } = await deleteUserData(gone);

    expect(Object.values(rows).every((n) => n === 0)).toBe(true);
  });

  it("refuses an id that isn't a Clerk user id", async () => {
    const { deleteUserData } = await load();

    await expect(deleteUserData("../")).rejects.toThrow();
    await expect(deleteUserData("")).rejects.toThrow();
  });
});
