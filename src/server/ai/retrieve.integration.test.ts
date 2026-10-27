import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasEmbeddingKey } from "./models";

// Vector search against the real database. Modules load lazily so CI (no database) never
// connects. The first block uses made-up vectors and needs only DATABASE_URL; the second
// indexes a fixture with EMBEDDING_PROVIDER and also needs that provider's key.
const hasDatabase = !!process.env.DATABASE_URL;
const canEmbed = hasDatabase && hasEmbeddingKey;

type Modules = {
  db: typeof import("@/server/db").db;
  schema: typeof import("@/server/db/schema");
  orm: typeof import("drizzle-orm");
  retrieve: typeof import("./retrieve");
  model: string;
};

async function loadModules(): Promise<Modules> {
  return {
    db: (await import("@/server/db")).db,
    schema: await import("@/server/db/schema"),
    orm: await import("drizzle-orm"),
    retrieve: await import("./retrieve"),
    model: (await import("./models")).EMBEDDING_MODEL,
  };
}

// After every block in this file.
afterAll(async () => {
  if (hasDatabase) await (await import("@/server/db")).db.$client.end();
});

describe.skipIf(!hasDatabase)("searchByEmbedding (integration)", () => {
  const me = `test_me_${randomUUID()}`;
  const others = `test_others_${randomUUID()}`;
  let m: Modules;
  let myDocument: string;
  let otherDocument: string;
  // Points at one of my chunks, so it has a clear nearest neighbour.
  let query: number[];

  // Inserts a ready document with `count` chunks whose vectors Postgres draws at random, made by
  // the current embedding model unless `model` says otherwise.
  async function seedDocument(userId: string, count: number, model = m.model) {
    const status = "ready" as const;
    const { db, schema, orm } = m;
    const [doc] = await db
      .insert(schema.document)
      .values({ userId, name: `${userId}.pdf`, mimeType: "application/pdf", sizeBytes: 1, status })
      .returning({ id: schema.document.id });
    await db.execute(orm.sql`
      insert into chunk (document_id, user_id, content, page, position, token_count,
        start_offset, end_offset, embedding, embedding_model)
      select ${doc!.id}, ${userId}, 'chunk ' || g, 1, g, 2, 0, 7,
        (select array_agg(random() - 0.5) from generate_series(1, 1536) where g > 0)::vector,
        ${model}
      from generate_series(1, ${count}) g`);
    return doc!.id;
  }

  beforeAll(async () => {
    m = await loadModules();
    // I own 30 of ~1,030 chunks (3%), so a plain HNSW scan finds almost none of them.
    otherDocument = await seedDocument(others, 1000);
    myDocument = await seedDocument(me, 30);
    await m.db.execute(m.orm.sql`analyze chunk`);

    const [mine] = await m.db
      .select({ embedding: m.schema.chunk.embedding })
      .from(m.schema.chunk)
      .where(m.orm.eq(m.schema.chunk.userId, me))
      .limit(1);
    query = mine!.embedding;
  }, 120_000);

  afterAll(async () => {
    await m.db
      .delete(m.schema.document)
      .where(m.orm.inArray(m.schema.document.userId, [me, others]));
  });

  it("returns only the user's own passages, best first", async () => {
    const passages = await m.retrieve.searchByEmbedding(query, { userId: me });

    expect(passages).toHaveLength(5);
    expect(passages.every((p) => p.documentId === myDocument)).toBe(true);
    expect(passages[0]!.similarity).toBeCloseTo(1, 5);
    const scores = passages.map((p) => p.similarity);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("isn't cut short when the planner uses the HNSW index", async () => {
    const { db, orm } = m;
    await db.transaction(async (tx) => {
      // Make the planner order by the HNSW index instead of sorting my rows, and keep its
      // candidate list small, as in a large table where I own a small share.
      await tx.execute(orm.sql`set local enable_sort = off`);
      await tx.execute(orm.sql`set local hnsw.ef_search = 10`);
      const plain = orm.sql`
        select chunk.id from chunk
        where chunk.user_id = ${me}
        order by chunk.embedding <=> ${`[${query.join(",")}]`}::vector
        limit 5`;

      const plan = await tx.execute<{ "QUERY PLAN": string }>(orm.sql`explain ${plain}`);
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
        "chunk_embedding_hnsw_idx",
      );

      // Without iterative scans, filtering after the index scan loses rows.
      await tx.execute(orm.sql`set local hnsw.iterative_scan = off`);
      const { rows } = await tx.execute(plain);
      expect(rows.length).toBeLessThan(5);

      // searchByEmbedding turns them on, so it still finds five.
      const passages = await m.retrieve.searchByEmbedding(query, { userId: me }, tx);
      expect(passages).toHaveLength(5);
      expect(passages.every((p) => p.documentId === myDocument)).toBe(true);
    });
  });

  it("searches only the given documents, and only the user's", async () => {
    const { searchByEmbedding } = m.retrieve;

    expect(await searchByEmbedding(query, { userId: me, documentIds: [otherDocument] })).toEqual(
      [],
    );
    expect(await searchByEmbedding(query, { userId: me, documentIds: [] })).toEqual([]);
    const mine = await searchByEmbedding(query, { userId: me, documentIds: [myDocument] });
    expect(mine).toHaveLength(5);
  });

  it("skips documents that aren't ready", async () => {
    await m.db
      .update(m.schema.document)
      .set({ status: "indexing" })
      .where(m.orm.eq(m.schema.document.id, myDocument));

    expect(await m.retrieve.searchByEmbedding(query, { userId: me })).toEqual([]);

    await m.db
      .update(m.schema.document)
      .set({ status: "ready" })
      .where(m.orm.eq(m.schema.document.id, myDocument));
  });

  it("skips chunks embedded by a different model", async () => {
    const other = await seedDocument(me, 5, "other/old-model");
    const [chunkFromOther] = await m.db
      .select({ embedding: m.schema.chunk.embedding })
      .from(m.schema.chunk)
      .where(m.orm.eq(m.schema.chunk.documentId, other))
      .limit(1);

    const passages = await m.retrieve.searchByEmbedding(chunkFromOther!.embedding, {
      userId: me,
    });

    expect(passages.some((p) => p.documentId === other)).toBe(false);
    await m.db.delete(m.schema.document).where(m.orm.eq(m.schema.document.id, other));
  });

  it("drops passages below minSimilarity", async () => {
    const passages = await m.retrieve.searchByEmbedding(query, {
      userId: me,
      minSimilarity: 0.99,
    });

    // Only the chunk the query was copied from; random vectors are nowhere near it.
    expect(passages).toHaveLength(1);
  });
});

describe.skipIf(!canEmbed)("searchPassages (integration, live embeddings)", () => {
  const alice = `test_alice_${randomUUID()}`;
  const bob = `test_bob_${randomUUID()}`;
  const question = "How much notice do I need to give to end the tenancy?";
  let m: Modules;
  let indexDocument: typeof import("@/server/ingest/index-document").indexDocument;
  const documents: Record<string, string> = {};

  beforeAll(async () => {
    m = await loadModules();
    ({ indexDocument } = await import("@/server/ingest/index-document"));
    const bytes = new Uint8Array(readFileSync("tests/fixtures/two-pages.pdf"));

    // The same file for both users.
    for (const userId of [alice, bob]) {
      const [doc] = await m.db
        .insert(m.schema.document)
        .values({
          userId,
          name: "Tenancy agreement.pdf",
          mimeType: "application/pdf",
          sizeBytes: bytes.length,
          blobPathname: `users/${userId}/${randomUUID()}-Tenancy agreement.pdf`,
        })
        .returning({ id: m.schema.document.id });
      documents[userId] = doc!.id;
      await indexDocument(userId, doc!.id, { load: async () => bytes });
    }
  }, 120_000);

  afterAll(async () => {
    const users = [alice, bob];
    await m.db.delete(m.schema.document).where(m.orm.inArray(m.schema.document.userId, users));
    await m.db.delete(m.schema.aiUsage).where(m.orm.inArray(m.schema.aiUsage.userId, users));
  });

  it("never returns another user's passages, even for an identical document and query", async () => {
    const forBob = await m.retrieve.searchPassages({ userId: bob, query: question });
    const forAlice = await m.retrieve.searchPassages({ userId: alice, query: question });

    expect(forBob.length).toBeGreaterThan(0);
    expect(forBob.every((p) => p.documentId === documents[bob])).toBe(true);
    expect(forAlice.every((p) => p.documentId === documents[alice])).toBe(true);
    // PDF extraction turns ' into ’.
    expect(forBob[0]!.content).toMatch(/two months[’'] notice/);
  });

  it("returns nothing when asked to search another user's document", async () => {
    const passages = await m.retrieve.searchPassages({
      userId: bob,
      query: question,
      documentIds: [documents[alice]!],
    });

    expect(passages).toEqual([]);
  });

  it("records the query's embedding usage", async () => {
    const rows = await m.db
      .select()
      .from(m.schema.aiUsage)
      .where(
        m.orm.and(
          m.orm.eq(m.schema.aiUsage.userId, bob),
          m.orm.eq(m.schema.aiUsage.kind, "embed-query"),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
