import "server-only";

import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, id, updatedAt, userId } from "./columns";
import type { ChatMessagePart } from "@/features/chat/message";

import { messageFeedback, messageRole, messageStatus } from "./enums";

// AI SDK UIMessage parts (src/features/chat/message.ts): text, plus data-passages and
// data-citations on answers. Validated when read (validateUIMessages).
export type MessagePart = ChatMessagePart;

export const chat = pgTable(
  "chat",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chat_user_id_idx").on(t.userId)],
);

export const message = pgTable(
  "message",
  {
    id: id(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    // Copied from the chat so every user-data table can be filtered by userId directly.
    userId: userId(),
    role: messageRole("role").notNull(),
    parts: jsonb("parts").$type<MessagePart[]>().notNull(),
    // Answers: whether generation finished, was stopped, or failed. User messages are complete.
    status: messageStatus("status").notNull().default("complete"),
    // The user's thumbs up or down on an answer.
    feedback: messageFeedback("feedback"),
    createdAt: createdAt(),
  },
  (t) => [
    index("message_user_id_idx").on(t.userId),
    index("message_chat_id_created_at_idx").on(t.chatId, t.createdAt),
  ],
);

export type Chat = typeof chat.$inferSelect;
export type NewChat = typeof chat.$inferInsert;
export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
export type MessageRole = Message["role"];
