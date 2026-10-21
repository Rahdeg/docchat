import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { document, type Document } from "@/server/db/schema";

export async function listDocuments(userId: string): Promise<Document[]> {
  return db
    .select()
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(desc(document.createdAt));
}

export async function getDocument(userId: string, documentId: string): Promise<Document | null> {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.id, documentId)))
    .limit(1);
  return row ?? null;
}
