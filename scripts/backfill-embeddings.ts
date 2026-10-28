import "./lib/load-env";

import { parseArgs } from "node:util";

import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";

import { embedChunks } from "@/server/ai/embed";
import { EMBEDDING_MODEL } from "@/server/ai/models";
import { db } from "@/server/db";
import { chunk, document } from "@/server/db/schema";

// (Re-)embeds chunks of ready documents whose embedding is missing or was made by a different
// model than EMBEDDING_MODEL: documents indexed before embeddings existed (PR 5), and every
// chunk after switching EMBEDDING_PROVIDER. Search skips such chunks until then. Safe to
// re-run: it only touches chunks that still need it, so a second run finds nothing to do. Run it
// on each Neon branch before migrating the embedding columns to NOT NULL. Uses DATABASE_URL, so
// point it at another branch with `DATABASE_URL=… pnpm db:backfill-embeddings`. `--dry-run`
// only counts.
const { values: flags } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { "dry-run": { type: "boolean", default: false } },
});

// No embedding, or one from another model (or of unknown origin).
const needsEmbedding = or(
  isNull(chunk.embedding),
  sql`${chunk.embeddingModel} is distinct from ${EMBEDDING_MODEL}`,
);

async function main() {
  const pending = await db
    .selectDistinct({ documentId: chunk.documentId, userId: chunk.userId, name: document.name })
    .from(chunk)
    .innerJoin(document, and(eq(document.id, chunk.documentId), eq(document.userId, chunk.userId)))
    .where(and(needsEmbedding, eq(document.status, "ready")));

  // Chunks of documents that aren't ready are replaced when the document is indexed again, so
  // they aren't backfilled. They'd still make the NOT NULL migration fail, so say so.
  const [notReady] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(and(needsEmbedding, ne(document.status, "ready")));

  console.log(
    `${pending.length} ready document(s) have chunks without a ${EMBEDDING_MODEL} embedding.`,
  );
  if (notReady && notReady.count > 0) {
    console.warn(
      `${notReady.count} chunk(s) needing an embedding belong to documents that aren't ready. ` +
        "Delete those documents (or retry them) before migrating the embedding columns to NOT NULL.",
    );
  }
  if (flags["dry-run"] || pending.length === 0) return;

  let chunks = 0;
  for (const [index, doc] of pending.entries()) {
    const where = and(
      eq(chunk.userId, doc.userId),
      eq(chunk.documentId, doc.documentId),
      needsEmbedding,
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
          .set({ embedding: embeddings[i]!, embeddingModel: EMBEDDING_MODEL })
          .where(and(eq(chunk.id, row.id), needsEmbedding));
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
