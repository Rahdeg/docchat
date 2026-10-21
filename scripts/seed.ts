import "./lib/load-env";

import { eq } from "drizzle-orm";

import { EMBEDDING_DIMENSIONS } from "@/server/ai/constants";
import { db } from "@/server/db";
import { chat, chunk, document, message, task } from "@/server/db/schema";

import { assertDevelopment } from "./lib/assert-development";
import { fakeEmbedding } from "./lib/fake-embedding";

// Not a real Clerk user. Seeding deletes and recreates only this user's rows.
const SEED_USER_ID = "user_seed_dev";

const documents = [
  {
    name: "Employee handbook.pdf",
    mimeType: "application/pdf",
    sizeBytes: 482_113,
    pageCount: 3,
    chunks: [
      "New starters get 25 days of annual leave plus bank holidays.",
      "Expense claims must be submitted within 30 days with a receipt.",
      "Remote work is allowed up to three days a week with manager approval.",
    ],
  },
  {
    name: "Q3 product roadmap.md",
    mimeType: "text/markdown",
    sizeBytes: 12_408,
    pageCount: null,
    chunks: [
      "Ship document upload with PDF and Markdown support by the end of August.",
      "Cited answers: every response links back to the source chunk and page.",
    ],
  },
] as const;

async function main() {
  assertDevelopment(process.env.NODE_ENV);

  await db.transaction(async (tx) => {
    // Cascades remove chunks and messages; tasks' source_chunk_id is set null first.
    await tx.delete(task).where(eq(task.userId, SEED_USER_ID));
    await tx.delete(document).where(eq(document.userId, SEED_USER_ID));
    await tx.delete(chat).where(eq(chat.userId, SEED_USER_ID));

    const chunkIds: string[] = [];
    for (const [docIndex, doc] of documents.entries()) {
      const [created] = await tx
        .insert(document)
        .values({
          userId: SEED_USER_ID,
          name: doc.name,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          pageCount: doc.pageCount,
          status: "ready",
        })
        .returning({ id: document.id });
      if (!created) throw new Error(`Failed to insert ${doc.name}`);

      const inserted = await tx
        .insert(chunk)
        .values(
          doc.chunks.map((content, position) => ({
            documentId: created.id,
            userId: SEED_USER_ID,
            content,
            page: doc.pageCount ? position + 1 : null,
            position,
            tokenCount: content.split(/\s+/).length,
            embedding: fakeEmbedding(docIndex * 100 + position, EMBEDDING_DIMENSIONS),
          })),
        )
        .returning({ id: chunk.id });
      chunkIds.push(...inserted.map((c) => c.id));
    }

    await tx.insert(document).values({
      userId: SEED_USER_ID,
      name: "Scanned contract.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_904_511,
      status: "failed",
      error: "No extractable text (scanned image)",
    });

    const [createdChat] = await tx
      .insert(chat)
      .values({ userId: SEED_USER_ID, title: "Leave and expenses" })
      .returning({ id: chat.id });
    if (!createdChat) throw new Error("Failed to insert chat");

    await tx.insert(message).values([
      {
        chatId: createdChat.id,
        userId: SEED_USER_ID,
        role: "user",
        parts: [{ type: "text", text: "How many days of leave do new starters get?" }],
      },
      {
        chatId: createdChat.id,
        userId: SEED_USER_ID,
        role: "assistant",
        parts: [{ type: "text", text: "New starters get 25 days plus bank holidays [1]." }],
      },
    ]);

    await tx.insert(task).values([
      {
        userId: SEED_USER_ID,
        title: "Submit August expenses",
        dueDate: "2026-11-15",
        sourceChunkId: chunkIds[1],
      },
      { userId: SEED_USER_ID, title: "Book remaining annual leave", sourceChunkId: chunkIds[0] },
      { userId: SEED_USER_ID, title: "Read the Q3 roadmap", done: true },
    ]);
  });

  console.log(`Seeded documents, a chat and tasks for ${SEED_USER_ID}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
