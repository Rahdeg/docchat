"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ActionError, authedAction } from "@/lib/action";

import { feedbackValues, TITLE_MAX_CHARS } from "./message";
import { deleteChat as deleteChatRow, renameChat as renameChatRow, setFeedback } from "./mutations";

// Answers stream from POST /api/chat; these are the chat's other writes.

const renameInput = z.object({
  id: z.uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Give the chat a name.")
    .max(TITLE_MAX_CHARS * 2, `Keep it under ${TITLE_MAX_CHARS * 2} characters.`),
});

export const renameChat = authedAction(renameInput, async ({ id, title }, { userId }) => {
  if (!(await renameChatRow(userId, id, title))) throw new ActionError("This chat doesn't exist.");
  refresh();
  return { id, title };
});

const chatIdInput = z.object({ id: z.uuid() });

export const deleteChat = authedAction(chatIdInput, async ({ id }, { userId }) => {
  if (!(await deleteChatRow(userId, id))) throw new ActionError("This chat doesn't exist.");
  refresh();
  return { id };
});

const feedbackInput = z.object({
  messageId: z.uuid(),
  // null clears it (pressing the same thumb again).
  feedback: z.enum(feedbackValues).nullable(),
});

export const rateAnswer = authedAction(
  feedbackInput,
  async ({ messageId, feedback }, { userId }) => {
    if (!(await setFeedback(userId, messageId, feedback))) {
      throw new ActionError("This answer doesn't exist.");
    }
    return { messageId, feedback };
  },
);
