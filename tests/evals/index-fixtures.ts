// Indexes the eval's fixture documents for an eval user, for real (EMBEDDING_PROVIDER). Shared
// by the retrieval and answer evals.
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { document } from "@/server/db/schema";
import { indexDocument } from "@/server/ingest/index-document";

import { fixtureBytes } from "./retrieval-cases";

export async function indexFixtures(
  userId: string,
  fixtures: { file: string; name: string }[],
): Promise<void> {
  // Start clean: documents cascade to their pages and chunks. Usage rows stay (real spend).
  await db.delete(document).where(eq(document.userId, userId));

  for (const fixture of fixtures) {
    const bytes = fixtureBytes(fixture.file);
    const [row] = await db
      .insert(document)
      .values({
        userId,
        name: fixture.name,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        blobPathname: `users/${userId}/eval-${fixture.file}`,
      })
      .returning({ id: document.id });
    await indexDocument(userId, row!.id, { load: async () => bytes });

    const [indexed] = await db.select().from(document).where(eq(document.id, row!.id));
    if (indexed?.status !== "ready") {
      throw new Error(`Indexing ${fixture.name} failed: ${indexed?.error ?? "unknown error"}`);
    }
  }
}
