import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_MODEL, hasEmbeddingKey } from "@/server/ai/models";

// Indexes the fixture PDFs into the real database (the file comes from disk, not Blob) and
// embeds them with EMBEDDING_PROVIDER. Runs only when DATABASE_URL and that provider's key are
// set; CI skips it. Database modules load lazily so CI never connects.
const canRun = !!process.env.DATABASE_URL && hasEmbeddingKey;

describe.skipIf(!canRun)("indexDocument (integration)", () => {
  const alice = `test_alice_${randomUUID()}`;
  const bob = `test_bob_${randomUUID()}`;
  const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

  let indexDocument: typeof import("./index-document").indexDocument;
  let dbModule: typeof import("@/server/db");
  let schema: typeof import("@/server/db/schema");
  let orm: typeof import("drizzle-orm");

  beforeAll(async () => {
    ({ indexDocument } = await import("./index-document"));
    dbModule = await import("@/server/db");
    schema = await import("@/server/db/schema");
    orm = await import("drizzle-orm");
  });

  afterAll(async () => {
    await dbModule.db
      .delete(schema.document)
      .where(orm.inArray(schema.document.userId, [alice, bob]));
    await dbModule.db
      .delete(schema.aiUsage)
      .where(orm.inArray(schema.aiUsage.userId, [alice, bob]));
    await dbModule.db.$client.end();
  });

  async function createUpload(userId: string, name: string) {
    const [row] = await dbModule.db
      .insert(schema.document)
      .values({
        userId,
        name,
        mimeType: "application/pdf",
        sizeBytes: 1,
        blobPathname: `users/${userId}/${randomUUID()}-${name}`,
      })
      .returning();
    return row!;
  }

  async function load(documentId: string) {
    const { db } = dbModule;
    const { document, documentPage, chunk } = schema;
    const { asc, eq } = orm;
    const [doc] = await db.select().from(document).where(eq(document.id, documentId));
    const pages = await db
      .select()
      .from(documentPage)
      .where(eq(documentPage.documentId, documentId))
      .orderBy(asc(documentPage.pageNumber));
    const chunks = await db
      .select()
      .from(chunk)
      .where(eq(chunk.documentId, documentId))
      .orderBy(asc(chunk.position));
    return { doc: doc!, pages, chunks };
  }

  it("stores each page and its embedded chunks, then marks the document ready", async () => {
    const created = await createUpload(alice, "two-pages.pdf");

    await indexDocument(alice, created.id, { load: async () => fixture("two-pages.pdf") });

    const { doc, pages, chunks } = await load(created.id);
    expect(doc).toMatchObject({ status: "ready", error: null, pageCount: 2, pagesRead: 2 });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(pages.every((p) => p.userId === alice)).toBe(true);
    expect(pages[0]!.text).toContain("The rent is 950 pounds a month");

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
    for (const c of chunks) {
      expect(c.userId).toBe(alice);
      expect(c.embedding).toHaveLength(1536);
      expect(c.embeddingModel).toBe(EMBEDDING_MODEL);
      const page = pages.find((p) => p.pageNumber === c.page)!;
      expect(page.text.slice(c.startOffset, c.endOffset)).toBe(c.content);
    }

    const usage = await dbModule.db
      .select()
      .from(schema.aiUsage)
      .where(orm.eq(schema.aiUsage.userId, alice));
    expect(usage.length).toBeGreaterThanOrEqual(1);
    expect(usage[0]).toMatchObject({ kind: "embed-index", model: EMBEDDING_MODEL });
    expect(usage[0]!.tokens).toBeGreaterThan(0);
  });

  it("re-indexes from scratch on retry, without duplicating pages or chunks", async () => {
    const created = await createUpload(alice, "retry.pdf");
    const options = { load: async () => fixture("two-pages.pdf") };
    await indexDocument(alice, created.id, options);
    const before = await load(created.id);

    // What retryDocument does: put it back in the queue, then index again.
    await dbModule.db
      .update(schema.document)
      .set({ status: "uploaded" })
      .where(orm.eq(schema.document.id, created.id));
    await indexDocument(alice, created.id, options);

    const after = await load(created.id);
    expect(after.doc.status).toBe("ready");
    expect(after.pages).toHaveLength(before.pages.length);
    expect(after.chunks).toHaveLength(before.chunks.length);
  });

  it("does nothing when the document isn't waiting to be indexed", async () => {
    const created = await createUpload(alice, "twice.pdf");
    const options = { load: async () => fixture("two-pages.pdf") };
    await indexDocument(alice, created.id, options);
    const first = await load(created.id);

    await indexDocument(alice, created.id, options);

    expect((await load(created.id)).chunks.map((c) => c.id)).toEqual(first.chunks.map((c) => c.id));
  });

  it("marks a PDF with no text as failed, with a message for the user", async () => {
    const created = await createUpload(alice, "no-text.pdf");

    await indexDocument(alice, created.id, { load: async () => fixture("no-text.pdf") });

    const { doc, pages, chunks } = await load(created.id);
    expect(doc).toMatchObject({
      status: "failed",
      error: "No text found. Scanned PDFs aren't supported yet.",
    });
    expect(pages).toEqual([]);
    expect(chunks).toEqual([]);
  });

  it("marks the document failed when its file is missing", async () => {
    const created = await createUpload(alice, "gone.pdf");

    await indexDocument(alice, created.id, { load: async () => null });

    expect((await load(created.id)).doc).toMatchObject({
      status: "failed",
      error: "We couldn't find the uploaded file. Remove it and upload it again.",
    });
  });

  it("won't index another user's document", async () => {
    const created = await createUpload(alice, "private.pdf");

    await indexDocument(bob, created.id, { load: async () => fixture("two-pages.pdf") });

    const { doc, chunks } = await load(created.id);
    expect(doc.status).toBe("uploaded");
    expect(chunks).toEqual([]);
  });
});
