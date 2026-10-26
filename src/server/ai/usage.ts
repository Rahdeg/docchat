import "server-only";

import { db } from "@/server/db";
import { aiUsage, type AiUsageKind } from "@/server/db/schema";

type Usage = { userId: string; kind: AiUsageKind; model: string; tokens: number };

// Records one model call. Runs outside any transaction, so tokens spent on a document that
// later fails to index are still counted. A failed write is logged, never thrown: losing a
// usage row shouldn't fail the user's request.
export async function recordUsage(usage: Usage): Promise<void> {
  await db
    .insert(aiUsage)
    .values(usage)
    .catch((error: unknown) => console.error("Couldn't record AI usage", error));
}
