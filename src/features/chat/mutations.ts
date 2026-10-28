import "server-only";

import { and, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/server/db";
import { chat, message, type Chat } from "@/server/db/schema";

import type { ChatUIMessage, Feedback, MessageStatus } from "./message";

// Writes on a user's chats and messages. Like queries.ts, each takes userId first and filters
// by it.

// The chat a message is posted to. The browser picks a new chat's id (a UUID) before its first
// message; the chat is created then, titled after that question. Returns null when the id
// belongs to another user's chat.
export async function ensureChat(
  userId: string,
  chatId: string,
  title: string,
): Promise<Chat | null> {
  const [created] = await db
    .insert(chat)
    .values({ id: chatId, userId, title })
    .onConflictDoNothing({ target: chat.id })
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.userId, userId), eq(chat.id, chatId)))
    .limit(1);
  return existing ?? null;
}

// Saves the user's question as soon as it arrives. Sending the same message again ("Try again"
// resends the last question) keeps the stored one. Returns when it was stored.
export async function saveUserMessage(
  userId: string,
  chatId: string,
  question: Pick<ChatUIMessage, "id" | "parts">,
): Promise<Date | null> {
  return db.transaction(async (tx) => {
    await tx
      .insert(message)
      .values({ id: question.id, chatId, userId, role: "user", parts: question.parts })
      .onConflictDoNothing({ target: message.id });
    const [stored] = await tx
      .select({ createdAt: message.createdAt })
      .from(message)
      .where(
        and(eq(message.userId, userId), eq(message.chatId, chatId), eq(message.id, question.id)),
      )
      .limit(1);
    // Most recently active first in the sidebar.
    await tx
      .update(chat)
      .set({ updatedAt: new Date() })
      .where(and(eq(chat.userId, userId), eq(chat.id, chatId)));
    return stored?.createdAt ?? null;
  });
}

// "Try again": removes the answers (and anything else) after the question being answered again.
export async function deleteMessagesAfter(
  userId: string,
  chatId: string,
  after: Date,
): Promise<void> {
  await db
    .delete(message)
    .where(
      and(eq(message.userId, userId), eq(message.chatId, chatId), gt(message.createdAt, after)),
    );
}

// Saves an answer when its stream ends, with what was generated so far if it was stopped or
// failed.
export async function saveAnswer(
  userId: string,
  chatId: string,
  answer: Pick<ChatUIMessage, "id" | "parts">,
  status: MessageStatus,
): Promise<void> {
  await db
    .insert(message)
    .values({ id: answer.id, chatId, userId, role: "assistant", parts: answer.parts, status })
    .onConflictDoUpdate({
      target: message.id,
      set: { parts: answer.parts, status },
      // Never overwrite a message of someone else's, whatever id the stream was given.
      setWhere: and(eq(message.userId, userId), eq(message.chatId, chatId)),
    });
}

export async function renameChat(userId: string, chatId: string, title: string): Promise<boolean> {
  const rows = await db
    .update(chat)
    .set({ title })
    .where(and(eq(chat.userId, userId), eq(chat.id, chatId)))
    .returning({ id: chat.id });
  return rows.length > 0;
}

// Deletes the chat; its messages go with it (cascade).
export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const rows = await db
    .delete(chat)
    .where(and(eq(chat.userId, userId), eq(chat.id, chatId)))
    .returning({ id: chat.id });
  return rows.length > 0;
}

// Thumbs up or down on an answer, or null to clear it.
export async function setFeedback(
  userId: string,
  messageId: string,
  feedback: Feedback | null,
): Promise<boolean> {
  const rows = await db
    .update(message)
    .set({ feedback })
    .where(
      and(
        eq(message.userId, userId),
        eq(message.id, messageId),
        inArray(message.role, ["assistant"]),
      ),
    )
    .returning({ id: message.id });
  return rows.length > 0;
}
