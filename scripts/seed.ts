import "./lib/load-env";

import { eq } from "drizzle-orm";

import { chunkPages } from "@/server/ai/chunk";
import { embedChunks } from "@/server/ai/embed";
import { EMBEDDING_MODEL } from "@/server/ai/models";
import { db } from "@/server/db";
import { chat, chunk, document, documentPage, message, task } from "@/server/db/schema";

import { assertDevelopment } from "./lib/assert-development";
import { resolveSeedUserId } from "./lib/seed-user";

// Seeding deletes and recreates only this user's rows. Pass your own Clerk user ID to see the
// sample data after signing in: `pnpm db:seed --user user_…` or SEED_USER_ID=user_….
const SEED_USER_ID = resolveSeedUserId(process.argv.slice(2), process.env.SEED_USER_ID);

// Sample rows have no file in Blob (blobPathname is null), so they can't be opened or retried.
const documents = [
  {
    name: "Employee handbook.pdf",
    mimeType: "application/pdf",
    sizeBytes: 482_113,
    pages: [
      "Employee handbook\n\nAnnual leave. New starters get 25 days of annual leave plus bank holidays.",
      "Expenses. Expense claims must be submitted within 30 days with a receipt.",
      "Remote work. Remote work is allowed up to three days a week with manager approval.",
    ],
  },
  {
    name: "Q3 product roadmap.md",
    mimeType: "text/markdown",
    sizeBytes: 12_408,
    pages: [
      "# Q3 product roadmap\n\nShip document upload with PDF and Markdown support by the end of August.\n\nCited answers: every response links back to the source chunk and page.",
    ],
  },
] as const;

async function main() {
  assertDevelopment(process.env.NODE_ENV);

  // The real chunker and real embeddings (from EMBEDDING_PROVIDER, so its key must be set),
  // so seeded documents behave like uploads in search. Embedded before the transaction,
  // as indexing does; a few hundred tokens, a fraction of a cent.
  const chunked = documents.map((doc) => chunkPages(doc.pages));
  const embeddings = await Promise.all(
    chunked.map((chunks) => embedChunks(SEED_USER_ID, chunks)),
  ).catch((error: unknown) => {
    throw new Error(
      "Couldn't embed the sample chunks. Check EMBEDDING_PROVIDER and its key in .env.local (README, Embeddings setup).",
      { cause: error },
    );
  });

  await db.transaction(async (tx) => {
    // Cascades remove chunks and messages; tasks' source_chunk_id is set null first.
    await tx.delete(task).where(eq(task.userId, SEED_USER_ID));
    await tx.delete(document).where(eq(document.userId, SEED_USER_ID));
    await tx.delete(chat).where(eq(chat.userId, SEED_USER_ID));

    const chunkIds: string[] = [];
    const documentIds: string[] = [];
    for (const [docIndex, doc] of documents.entries()) {
      const [created] = await tx
        .insert(document)
        .values({
          userId: SEED_USER_ID,
          name: doc.name,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          pageCount: doc.pages.length,
          pagesRead: doc.pages.length,
          status: "ready",
        })
        .returning({ id: document.id });
      if (!created) throw new Error(`Failed to insert ${doc.name}`);
      documentIds.push(created.id);

      await tx.insert(documentPage).values(
        doc.pages.map((text, index) => ({
          documentId: created.id,
          userId: SEED_USER_ID,
          pageNumber: index + 1,
          text,
        })),
      );

      const inserted = await tx
        .insert(chunk)
        .values(
          chunked[docIndex]!.map((c, i) => ({
            documentId: created.id,
            userId: SEED_USER_ID,
            content: c.content,
            page: c.page,
            position: c.position,
            tokenCount: c.tokenCount,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            embedding: embeddings[docIndex]![i]!,
            embeddingModel: EMBEDDING_MODEL,
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
      error: "No text found. Scanned PDFs aren't supported yet.",
    });

    const [createdChat] = await tx
      .insert(chat)
      .values({ userId: SEED_USER_ID, title: "Leave and expenses" })
      .returning({ id: chat.id });
    if (!createdChat) throw new Error("Failed to insert chat");

    const leaveQuestion = "How many days of leave do new starters get?";
    const leaveSentence = "New starters get 25 days of annual leave plus bank holidays.";
    const handbook = chunked[0]![0]!;
    const leavePassage = {
      chunkId: chunkIds[0]!,
      documentId: documentIds[0]!,
      name: documents[0].name,
      mimeType: documents[0].mimeType,
      hasFile: false,
      page: handbook.page,
      content: handbook.content,
      startOffset: handbook.startOffset,
      endOffset: handbook.endOffset,
      similarity: 0.74,
    };

    await tx.insert(message).values([
      {
        chatId: createdChat.id,
        userId: SEED_USER_ID,
        role: "user",
        parts: [{ type: "text", text: leaveQuestion }],
        // Messages are read oldest first; one insert would give both the same time.
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        chatId: createdChat.id,
        userId: SEED_USER_ID,
        role: "assistant",
        // In the format POST /api/chat saves (src/features/chat/message.ts), citing the
        // handbook's first chunk.
        parts: [
          {
            type: "data-passages",
            id: "passages",
            data: { query: leaveQuestion, passages: [leavePassage] },
          },
          { type: "text", text: "New starters get **25 days** plus bank holidays [1]." },
          {
            type: "data-citations",
            id: "citations",
            data: {
              final: true,
              citations: [
                {
                  number: 1,
                  source: 1,
                  quote: leaveSentence,
                  start: leavePassage.content.indexOf(leaveSentence),
                  end: leavePassage.content.indexOf(leaveSentence) + leaveSentence.length,
                  matched: true,
                },
              ],
            },
          },
        ],
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
