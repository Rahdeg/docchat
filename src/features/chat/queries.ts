import "server-only";

import { safeValidateUIMessages } from "ai";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { chat, message, type Chat } from "@/server/db/schema";

import { chatDataSchemas, chatMetadataSchema, type ChatUIMessage } from "./message";

export async function listChats(userId: string): Promise<Chat[]> {
  return db.select().from(chat).where(eq(chat.userId, userId)).orderBy(desc(chat.updatedAt));
}

export type RecentChat = Pick<Chat, "id" | "title">;

// Chats shown in the sidebar.
export const RECENT_CHATS = 20;

// Sidebar list, most recently active first: only the columns it shows.
export async function listRecentChats(userId: string, limit = RECENT_CHATS): Promise<RecentChat[]> {
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

export async function getChat(userId: string, chatId: string): Promise<Chat | null> {
  const [row] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.userId, userId), eq(chat.id, chatId)))
    .limit(1);
  return row ?? null;
}

// A chat's messages, oldest first, as AI SDK UIMessages with their status and feedback in the
// metadata. The stored parts are checked against the current schemas; if they don't fit (an
// older format), the chat opens empty rather than crashing, and the error is logged.
export async function listMessages(userId: string, chatId: string): Promise<ChatUIMessage[]> {
  const rows = await db
    .select()
    .from(message)
    .where(and(eq(message.userId, userId), eq(message.chatId, chatId)))
    .orderBy(asc(message.createdAt), asc(message.id));

  const messages = rows.flatMap((row) =>
    row.role === "user" || row.role === "assistant"
      ? [
          {
            id: row.id,
            role: row.role,
            parts: row.parts,
            metadata:
              row.role === "assistant" ? { status: row.status, feedback: row.feedback } : {},
          },
        ]
      : [],
  );
  if (messages.length === 0) return [];

  const result = await safeValidateUIMessages<ChatUIMessage>({
    messages,
    metadataSchema: chatMetadataSchema,
    dataSchemas: chatDataSchemas,
  });
  if (result.success) return result.data;
  console.error(`Chat ${chatId} has messages in an unexpected format`, result.error);
  return [];
}
