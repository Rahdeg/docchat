// What the chat composer sends to POST /api/chat. Shared, so both sides agree on it.
import { z } from "zod";

// Documents one question can be limited to. A bound on the request, not a free-tier limit:
// unlimited users can have more documents than MAX_DOCUMENTS_PER_USER.
const MAX_SCOPE_DOCUMENTS = 100;

import { approvalRequestSchema } from "./agent-parts";

export const questionRequestSchema = z.object({
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
  documentIds: z.array(z.uuid()).min(1).max(MAX_SCOPE_DOCUMENTS).optional(),
});

// "Add N tasks" or "Cancel" on the last answer's proposal (docs/adr/0007). Only the decision
// and the user's edits come up; the proposal itself is read from the database.
export const approvalBodySchema = z.object({
  chatId: z.uuid(),
  trigger: z.literal("submit-message"),
  approval: approvalRequestSchema,
});

export const chatRequestSchema = z.union([approvalBodySchema, questionRequestSchema]);

export type ChatRequestBody = z.input<typeof chatRequestSchema>;
export type QuestionRequestBody = z.input<typeof questionRequestSchema>;
export type ApprovalRequestBody = z.input<typeof approvalBodySchema>;
