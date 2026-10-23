import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { chat, type Chat } from "@/server/db/schema";

export async function listChats(userId: string): Promise<Chat[]> {
  return db.select().from(chat).where(eq(chat.userId, userId)).orderBy(desc(chat.updatedAt));
}

export type RecentChat = Pick<Chat, "id" | "title">;

// Sidebar list: only the columns it shows.
export async function listRecentChats(userId: string, limit = 5): Promise<RecentChat[]> {
  return db
    .select({ id: chat.id, title: chat.title })
    .from(chat)
    .where(eq(chat.userId, userId))
    .orderBy(desc(chat.updatedAt))
    .limit(limit);
}

export async function countChats(userId: string): Promise<number> {
  return db.$count(chat, eq(chat.userId, userId));
}
