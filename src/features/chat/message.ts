// The chat's message format, shared by the route handler, the database and the browser
// (docs/adr/0006). Messages are AI SDK UIMessages with two data parts on every answer:
//
// - data-passages: what the search found, numbered [1]..[N] in the order the model saw them.
//   A copy, so a saved chat renders the same after a document is deleted or re-read.
// - data-citations: the sources the answer cites, numbered 1, 2, 3 in order of first
//   appearance, each with the sentence it relied on and where that sentence is in the passage.
//
// The answer text carries the citation numbers as [1] markers.
import type { UIMessage } from "ai";
import { z } from "zod";

export const passageSchema = z.object({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  name: z.string(),
  mimeType: z.string(),
  hasFile: z.boolean(),
  page: z.number().int().nullable(),
  content: z.string(),
  startOffset: z.number().int(),
  endOffset: z.number().int(),
  similarity: z.number(),
});

export type PassageData = z.infer<typeof passageSchema>;

export const citationSchema = z.object({
  // Shown on the chip: 1, 2, 3 in order of first appearance.
  number: z.number().int().positive(),
  // The passage's [n] in the prompt: data-passages[source - 1].
  source: z.number().int().positive(),
  // The sentence the model said it relied on, or null when it gave none.
  quote: z.string().nullable(),
  // Highlight, as offsets into the passage's content. The whole passage when the quote
  // couldn't be found in it (matched: false).
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  matched: z.boolean(),
});

export type Citation = z.infer<typeof citationSchema>;

export const chatDataSchemas = {
  passages: z.object({
    // What was searched for: the question, or its standalone rewrite for a follow-up.
    query: z.string(),
    passages: z.array(passageSchema),
  }),
  citations: z.object({
    // False while the answer streams (numbers only, no quotes yet).
    final: z.boolean(),
    citations: z.array(citationSchema),
  }),
};

export type ChatDataTypes = {
  [K in keyof typeof chatDataSchemas]: z.infer<(typeof chatDataSchemas)[K]>;
};

export const messageStatuses = ["complete", "stopped", "failed"] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const feedbackValues = ["up", "down"] as const;
export type Feedback = (typeof feedbackValues)[number];

export const chatMetadataSchema = z.object({
  // Answers only. A stopped or failed answer keeps what was generated.
  status: z.enum(messageStatuses).optional(),
  feedback: z.enum(feedbackValues).nullable().optional(),
});

export type ChatMetadata = z.infer<typeof chatMetadataSchema>;

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataTypes>;
export type ChatMessagePart = ChatUIMessage["parts"][number];

// The canned start of an answer the documents don't support. The model is told to begin with
// it, and an answer that does carries no citations.
export const NO_ANSWER_PREFIX = "Your documents don't say";

// The whole answer to a question the documents have nothing to do with: nothing about what
// they do cover, so an unrelated passage is never summarised.
export const UNRELATED_ANSWER = `${NO_ANSWER_PREFIX} anything about that.`;

export function isNoAnswer(text: string): boolean {
  return normalizeApostrophes(text.trimStart()).startsWith(NO_ANSWER_PREFIX);
}

function normalizeApostrophes(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

export function messageText(message: Pick<ChatUIMessage, "parts">): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export function passagesOf(
  message: Pick<ChatUIMessage, "parts">,
): ChatDataTypes["passages"] | null {
  for (const part of message.parts) if (part.type === "data-passages") return part.data;
  return null;
}

// The latest citations part (there is one; while streaming it's replaced as it updates).
export function citationsOf(
  message: Pick<ChatUIMessage, "parts">,
): ChatDataTypes["citations"] | null {
  for (const part of message.parts) if (part.type === "data-citations") return part.data;
  return null;
}

// Shown when the AI provider refuses for quota (rate limit or daily quota). The question is
// saved, the answer isn't; the browser drops what had streamed of it.
export const FREE_LIMIT_MESSAGE = "DocChat has reached today's free AI limit. Try again tomorrow.";

// Chat titles: the first question, cut at a word to about 60 characters. No model call.
export const TITLE_MAX_CHARS = 60;

export function chatTitle(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= TITLE_MAX_CHARS) return flat;
  const cut = flat.slice(0, TITLE_MAX_CHARS);
  // Cut at the last space, unless the cut already falls between words.
  const space = flat[TITLE_MAX_CHARS] === " " ? TITLE_MAX_CHARS : cut.lastIndexOf(" ");
  return `${(space > TITLE_MAX_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}
