import "./lib/load-env";

import { parseArgs } from "node:util";

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { embedChunks } from "@/server/ai/embed";
import { db } from "@/server/db";
import { chunk, document } from "@/server/db/schema";

// Embeds chunks of ready documents that have no embedding yet: documents indexed before
// embeddings existed (PR 5). Safe to re-run: it only touches chunks that are still null, so a
// second run finds nothing to do. Run it on each Neon branch before migrating chunk.embedding
// to NOT NULL. Uses DATABASE_URL, so point it at another branch with
// `DATABASE_URL=… pnpm db:backfill-embeddings`. `--dry-run` only counts.
const { values: flags } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { "dry-run": { type: "boolean", default: false } },
});

async function main() {
  const pending = await db
    .selectDistinct({ documentId: chunk.documentId, userId: chunk.userId, name: document.name })
    .from(chunk)
    .innerJoin(document, and(eq(document.id, chunk.documentId), eq(document.userId, chunk.userId)))
    .where(and(isNull(chunk.embedding), eq(document.status, "ready")));

  // Chunks of documents that aren't ready are replaced when the document is indexed again, so
  // they aren't backfilled. They'd still make the NOT NULL migration fail, so say so.
  const [notReady] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(and(isNull(chunk.embedding), ne(document.status, "ready")));

  console.log(`${pending.length} ready document(s) have chunks without embeddings.`);
  if (notReady && notReady.count > 0) {
    console.warn(
      `${notReady.count} chunk(s) without embeddings belong to documents that aren't ready. ` +
        "Delete those documents (or retry them) before migrating chunk.embedding to NOT NULL.",
    );
  }
  if (flags["dry-run"] || pending.length === 0) return;

  let chunks = 0;
  for (const [index, doc] of pending.entries()) {
    const where = and(
      eq(chunk.userId, doc.userId),
      eq(chunk.documentId, doc.documentId),
      isNull(chunk.embedding),
    );
    const rows = await db
      .select({ id: chunk.id, content: chunk.content, tokenCount: chunk.tokenCount })
      .from(chunk)
      .where(where)
      .orderBy(asc(chunk.position));

    // Network first, then one short transaction per document.
    const embeddings = await embedChunks(doc.userId, rows);
    await db.transaction(async (tx) => {
      for (const [i, row] of rows.entries()) {
        await tx
          .update(chunk)
          .set({ embedding: embeddings[i]! })
          .where(and(eq(chunk.id, row.id), isNull(chunk.embedding)));
      }
    });

    chunks += rows.length;
    console.log(`[${index + 1}/${pending.length}] ${doc.name}: ${rows.length} chunk(s)`);
  }
  console.log(`Embedded ${chunks} chunk(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
