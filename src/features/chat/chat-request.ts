// What the chat composer sends to POST /api/chat. Shared, so both sides agree on it.
import { z } from "zod";

import { MAX_DOCUMENTS } from "../documents/upload-rules";

export const chatRequestSchema = z.object({
  chatId: z.uuid(),
  // "regenerate-message" is "Try again": the last question is answered again.
  trigger: z.enum(["submit-message", "regenerate-message"]),
  // The question. Earlier messages come from the database, never from the browser.
  message: z.object({
    id: z.uuid(),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string() }))
      .min(1)
      .max(1),
  }),
  // Leave out to search every ready document.
  documentIds: z.array(z.uuid()).min(1).max(MAX_DOCUMENTS).optional(),
});

export type ChatRequestBody = z.input<typeof chatRequestSchema>;
