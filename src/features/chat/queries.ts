import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { chat, type Chat } from "@/server/db/schema";

export async function listChats(userId: string): Promise<Chat[]> {
  return db.select().from(chat).where(eq(chat.userId, userId)).orderBy(desc(chat.updatedAt));
}
