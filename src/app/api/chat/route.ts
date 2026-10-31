import { randomUUID } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type InferUIMessageChunk,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";

import { ABOUT_ANSWER, isAboutDocChat } from "@/features/chat/about";
import { chatRequestSchema } from "@/features/chat/chat-request";
import { QUERY_MAX_CHARS, QUERY_MIN_CHARS } from "@/features/chat/find-rules";
import {
  chatTitle,
  FREE_LIMIT_MESSAGE,
  messageText,
  type ChatMetadata,
  type ChatUIMessage,
  type Citation,
  type PassageData,
} from "@/features/chat/message";
import {
  deleteMessagesAfter,
  ensureChat,
  saveAnswer,
  saveUserMessage,
} from "@/features/chat/mutations";
import { listMessages } from "@/features/chat/queries";
import { listReadyDocuments } from "@/features/documents/queries";
import {
  findAnswerPassages,
  noPassagesAnswer,
  rewriteQuery,
  streamAnswer,
  type AnswerStream,
} from "@/server/ai/answer";
import { isQuotaError } from "@/server/ai/call-model";
import { checkDailyLimit } from "@/server/ai/limits";

// Answers a question in a chat, streaming the answer with its sources and citations
// (docs/adr/0006). A route handler rather than a Server Action because it streams.
//
// The answer is cut off after 100 s (src/server/ai/answer.ts); this leaves room for the search
// and saving.
export const maxDuration = 120;

const questionSchema = z.string().trim().min(QUERY_MIN_CHARS).max(QUERY_MAX_CHARS);

// Plain-text errors: the browser shows the body as the message.
function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return fail(401, "You need to be signed in.");

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "That request wasn't valid.");
  const { chatId, trigger, documentIds } = parsed.data;
  const question = questionSchema.safeParse(messageText(parsed.data.message));
  if (!question.success) {
    return fail(400, `Ask with ${QUERY_MIN_CHARS} to ${QUERY_MAX_CHARS} characters.`);
  }
  const userMessage: ChatUIMessage = {
    id: parsed.data.message.id,
    role: "user",
    parts: [{ type: "text", text: question.data }],
  };

  // Before any model call: the free tier's daily quota is shared by every user.
  const limit = await checkDailyLimit(userId);
  if (!limit.ok) return fail(429, limit.message);

  // Creates the chat on its first question. Another user's chat id is a 404, as if it didn't
  // exist.
  const chat = await ensureChat(userId, chatId, chatTitle(question.data));
  if (!chat) return fail(404, "This chat doesn't exist.");

  const askedAt = await saveUserMessage(userId, chatId, userMessage);
  if (!askedAt) return fail(404, "This chat doesn't exist.");
  // A new question is already the last message; "Try again" drops the answer being replaced.
  if (trigger === "regenerate-message") await deleteMessagesAfter(userId, chatId, askedAt);

  const stored = await listMessages(userId, chatId);
  const index = stored.findIndex((m) => m.id === userMessage.id);
  const history = index === -1 ? stored : stored.slice(0, index);

  const messageId = randomUUID();
  let passages: PassageData[] = [];
  let answer: AnswerStream | null = null;
  // "quota": the provider refused for quota, and the answer isn't saved.
  let failure: "quota" | "error" | null = null;
  function failWith(error: unknown): string {
    if (isQuotaError(error)) failure = "quota";
    else failure ??= "error";
    return errorMessage(error);
  }

  const stream = createUIMessageStream<ChatUIMessage>({
    originalMessages: [...history, userMessage],
    async execute({ writer }) {
      writer.write({ type: "start", messageId });

      // A question about DocChat itself: one canned line, no search and no model call.
      if (isAboutDocChat(question.data)) {
        writeText(writer, ABOUT_ANSWER);
        writer.write({ type: "finish", messageMetadata: { status: "complete" } });
        return;
      }

      const query = await rewriteQuery(userId, history, question.data);
      passages = await findAnswerPassages({ userId, query, documentIds });
      writer.write({ type: "data-passages", id: "passages", data: { query, passages } });

      if (passages.length === 0) {
        const ready = await listReadyDocuments(userId);
        const names = ready
          .filter((d) => !documentIds || documentIds.includes(d.id))
          .map((d) => d.name);
        writeText(writer, noPassagesAnswer(names, !!documentIds));
        writer.write(citationsChunk([], true));
        writer.write({ type: "finish", messageMetadata: { status: "complete" } });
        return;
      }

      answer = streamAnswer({
        userId,
        question: question.data,
        history,
        passages,
        abortSignal: request.signal,
        // Chips show their source while the answer streams; quotes come at the end.
        onCite: (order) => writer.write(citationsChunk(provisional(order, passages), false)),
      });

      const reader = toUIMessageStream<ToolSet, ChatUIMessage>({
        stream: answer.result.stream,
        sendStart: false,
        sendFinish: false,
        // Gemini's thinking isn't shown.
        sendReasoning: false,
        onError: failWith,
      }).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(value);
      }

      if (request.signal.aborted || failure === "quota") return;
      writer.write(citationsChunk(finalCitations(answer), true));
      writer.write({
        type: "finish",
        messageMetadata: { status: failure ? "failed" : "complete" } satisfies ChatMetadata,
      });
    },
    onError: (error) => {
      console.error("Chat request failed", error);
      return failWith(error);
    },
    // Saves the answer however it ended. Stopped (the user pressed Stop or left) and failed
    // answers keep what was generated; their citations are resolved from what's there. One the
    // provider refused for quota isn't saved: the question stays, to ask again tomorrow.
    async onEnd({ responseMessage, isAborted, isCancelled, outcome }) {
      if (failure === "quota") {
        console.warn(`Answer ${messageId} not saved: the AI provider refused for quota`);
        return;
      }
      const status =
        isAborted || isCancelled
          ? "stopped"
          : failure || outcome.status === "failed"
            ? "failed"
            : "complete";
      const citations = answer ? finalCitations(answer) : [];
      const parts = [
        ...responseMessage.parts.filter((part) => part.type !== "data-citations"),
        ...(passages.length > 0 ? [citationsPart(citations)] : []),
      ];
      try {
        await saveAnswer(userId, chatId, { id: messageId, parts }, status);
      } catch (error) {
        console.error(`Couldn't save answer ${messageId}`, error);
      }
    },
  });

  return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
}

// A canned answer, as one text part.
function writeText(writer: UIMessageStreamWriter<ChatUIMessage>, text: string) {
  writer.write({ type: "text-start", id: "answer" });
  writer.write({ type: "text-delta", id: "answer", delta: text });
  writer.write({ type: "text-end", id: "answer" });
}

// Resolves once; the filter's state no longer changes after the stream ends.
const resolved = new WeakMap<AnswerStream, Citation[]>();

function finalCitations(answer: AnswerStream): Citation[] {
  let citations = resolved.get(answer);
  if (!citations) {
    const result = answer.finish();
    if (answer.filter.dropped.length > 0 || result.dropped.length > 0) {
      console.warn("Dropped citations to sources that weren't retrieved", {
        markers: answer.filter.dropped,
        quotes: result.dropped.map((q) => q.source),
      });
    }
    citations = result.citations;
    resolved.set(answer, citations);
  }
  return citations;
}

// Numbers only, while streaming: each highlights its whole passage until the quotes are in.
function provisional(order: readonly number[], passages: readonly PassageData[]): Citation[] {
  return order.map((source, index) => ({
    number: index + 1,
    source,
    quote: null,
    start: 0,
    end: passages[source - 1]!.content.length,
    matched: false,
  }));
}

function citationsPart(citations: Citation[]) {
  return { type: "data-citations" as const, id: "citations", data: { final: true, citations } };
}

function citationsChunk(citations: Citation[], final: boolean): InferUIMessageChunk<ChatUIMessage> {
  return { type: "data-citations", id: "citations", data: { final, citations } };
}

function errorMessage(error: unknown): string {
  if (isQuotaError(error)) return FREE_LIMIT_MESSAGE;
  return "Something went wrong while writing the answer. Try again.";
}
