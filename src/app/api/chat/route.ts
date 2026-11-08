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
import { addedTasksText, NO_TASKS_ADDED, type Proposal } from "@/features/chat/agent-parts";
import {
  chatRequestSchema,
  type approvalBodySchema,
  type questionRequestSchema,
} from "@/features/chat/chat-request";
import { QUERY_MAX_CHARS, QUERY_MIN_CHARS } from "@/features/chat/find-rules";
import {
  chatTitle,
  FREE_LIMIT_MESSAGE,
  messageText,
  type ChatMessagePart,
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
import { getChat, listMessages } from "@/features/chat/queries";
import { readyScope } from "@/features/chat/scope";
import { asksForTasks } from "@/features/chat/task-request";
import { listReadyDocuments } from "@/features/documents/queries";
import { answerProposal } from "@/features/tasks/agent-tasks";
import { AGENT_PASSAGES, streamAgent, type AgentStream, type AgentTools } from "@/server/ai/agent";
import {
  findAnswerPassages,
  noPassagesAnswer,
  rewriteQuery,
  streamAnswer,
  type AnswerStream,
} from "@/server/ai/answer";
import { isQuotaError } from "@/server/ai/call-model";
import { checkDailyLimit } from "@/server/ai/limits";
import { log } from "@/server/log";
import { identifyUser, reportError } from "@/server/monitoring";
import { consumeRateLimit } from "@/server/rate-limit";

// Answers a question in a chat, streaming the answer with its sources and citations
// (docs/adr/0006). A route handler rather than a Server Action because it streams.
//
// When the question asks for tasks (asksForTasks), the answer model also gets the agent's
// tools and may propose tasks for the user to approve (docs/adr/0007). The user's "Add" or
// "Cancel" comes back here too, as an approval request: no model call, just the decision.
//
// The answer is cut off after 100 s (src/server/ai/answer.ts, agent.ts); this leaves room for
// the search and saving.
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
  identifyUser(userId);

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "That request wasn't valid.");
  if ("approval" in parsed.data) return answerApproval(userId, parsed.data);
  return answerQuestion(userId, parsed.data, request.signal);
}

async function answerQuestion(
  userId: string,
  body: z.output<typeof questionRequestSchema>,
  signal: AbortSignal,
) {
  const { chatId, trigger } = body;
  const question = questionSchema.safeParse(messageText(body.message));
  if (!question.success) {
    return fail(400, `Ask with ${QUERY_MIN_CHARS} to ${QUERY_MAX_CHARS} characters.`);
  }
  const userMessage: ChatUIMessage = {
    id: body.message.id,
    role: "user",
    parts: [{ type: "text", text: question.data }],
  };

  // Before any model call: the free tier's daily quota is shared by every user.
  const limit = await checkDailyLimit(userId);
  if (!limit.ok) {
    log("quota.hit", { userId, limit: "daily" }, "warn");
    return fail(429, limit.message);
  }
  // Every question embeds a search query: RATE_LIMITS.search (src/lib/rate-limits.ts).
  const searches = await consumeRateLimit(userId, "search");
  if (!searches.ok) return fail(429, searches.message);

  // Only the user's ready documents: another user's id, or one being read or removed, is
  // dropped, and nothing left means all documents (src/features/chat/scope.ts).
  const scope = body.documentIds
    ? readyScope(await listReadyDocuments(userId), body.documentIds)
    : [];
  const documentIds = scope.length > 0 ? scope : undefined;

  // Creates the chat on its first question and saves the scope on it, so follow-ups and reloads
  // keep it. Another user's chat id is a 404, as if it didn't exist.
  const chat = await ensureChat(userId, chatId, chatTitle(question.data), scope);
  if (!chat) return fail(404, "This chat doesn't exist.");

  const askedAt = await saveUserMessage(userId, chatId, userMessage);
  if (!askedAt) return fail(404, "This chat doesn't exist.");
  // A new question is already the last message; "Try again" drops the answer being replaced.
  if (trigger === "regenerate-message") await deleteMessagesAfter(userId, chatId, askedAt);

  const stored = await listMessages(userId, chatId);
  const index = stored.findIndex((m) => m.id === userMessage.id);
  const history = index === -1 ? stored : stored.slice(0, index);

  // Task mode only when the user's own words ask for tasks: text in a document can never turn
  // the tools on.
  const taskMode = asksForTasks(question.data) && !isAboutDocChat(question.data);

  const messageId = randomUUID();
  let passages: PassageData[] = [];
  let answer: AnswerStream | null = null;
  let agent: AgentStream | null = null;
  // "quota": the provider refused for quota, and the answer isn't saved.
  let failure: "quota" | "error" | null = null;
  function failWith(error: unknown): string {
    if (isQuotaError(error)) {
      if (failure !== "quota") log("quota.hit", { userId, limit: "provider" }, "warn");
      failure = "quota";
    } else failure ??= "error";
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
      passages = await findAnswerPassages({
        userId,
        query,
        documentIds,
        limit: taskMode ? AGENT_PASSAGES : undefined,
      });
      writer.write({ type: "data-passages", id: "passages", data: { query, passages } });

      const ready =
        passages.length === 0 || taskMode
          ? (await listReadyDocuments(userId)).filter(
              (d) => !documentIds || documentIds.includes(d.id),
            )
          : [];
      // Nothing to answer from. In task mode the agent can still search, as long as there are
      // documents to search.
      if (passages.length === 0 && (!taskMode || ready.length === 0)) {
        writeText(
          writer,
          noPassagesAnswer(
            ready.map((d) => d.name),
            !!documentIds,
          ),
        );
        writer.write(citationsChunk([], true));
        writer.write({ type: "finish", messageMetadata: { status: "complete" } });
        return;
      }

      // Chips show their source while the answer streams; quotes come at the end.
      const onCite = (order: readonly number[]) =>
        writer.write(citationsChunk(provisional(order, agent?.run.passages ?? passages), false));

      let modelStream: ReadableStream<InferUIMessageChunk<ChatUIMessage>>;
      if (taskMode) {
        agent = streamAgent({
          userId,
          question: question.data,
          history,
          passages,
          documents: ready.map((d) => ({ id: d.id, name: d.name })),
          scope: documentIds,
          abortSignal: signal,
          onCite,
          // A search added passages: the Sources panel and the steps list follow.
          onPassages: (all) =>
            writer.write({
              type: "data-passages",
              id: "passages",
              data: { query, passages: [...all] },
            }),
        });
        modelStream = toUIMessageStream<AgentTools, ChatUIMessage>({
          stream: agent.result.stream,
          sendStart: false,
          sendFinish: false,
          // Gemini's thinking isn't shown.
          sendReasoning: false,
          onError: failWith,
        });
      } else {
        answer = streamAnswer({
          userId,
          question: question.data,
          history,
          passages,
          abortSignal: signal,
          onCite,
        });
        modelStream = toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: answer.result.stream,
          sendStart: false,
          sendFinish: false,
          sendReasoning: false,
          onError: failWith,
        });
      }

      const reader = modelStream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(value);
      }

      if (signal.aborted || failure === "quota") return;
      const { citations, proposal } = finalOf(answer, agent);
      writer.write(citationsChunk(citations, true));
      if (agent) writeProposal(writer, agent, proposal);
      writer.write({
        type: "finish",
        messageMetadata: { status: failure ? "failed" : "complete" } satisfies ChatMetadata,
      });
    },
    onError: (error) => {
      console.error("Chat request failed", error);
      if (!isQuotaError(error)) reportError(error, "chat");
      return failWith(error);
    },
    // Saves the answer however it ended. Stopped (the user pressed Stop or left) and failed
    // answers keep what was generated; their citations are resolved from what's there. One the
    // provider refused for quota isn't saved: the question stays, to ask again tomorrow, and
    // nothing the agent proposed survives.
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
      const { citations } = finalOf(answer, agent);
      const parts = [
        ...responseMessage.parts.filter(
          (part) => part.type !== "data-citations" && keepToolPart(part),
        ),
        ...(passages.length > 0 || agent ? [citationsPart(citations)] : []),
      ];
      try {
        await saveAnswer(userId, chatId, { id: messageId, parts }, status);
      } catch (error) {
        console.error(`Couldn't save answer ${messageId}`, error);
        reportError(error, "chat-save");
      }
    },
  });

  return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
}

// "Add N tasks" or "Cancel" on the last answer's proposal. answerProposal checks it and saves
// the ticked tasks (or nothing) in one transaction; the answer then gets the tool's result and
// a fixed line, with no model call.
async function answerApproval(userId: string, body: z.output<typeof approvalBodySchema>) {
  const { chatId, approval } = body;
  if (!(await getChat(userId, chatId))) return fail(404, "This chat doesn't exist.");

  // Only the last answer's proposal can be answered: its stream continues that message.
  const stored = await listMessages(userId, chatId);
  const target = stored.at(-1);
  if (target?.id !== approval.messageId || target.role !== "assistant") {
    return fail(409, "These suggestions are out of date. Ask again for new ones.");
  }

  const outcome = await answerProposal(userId, chatId, approval);
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  const proposed = proposedCount(target);
  if (outcome.approved) {
    log("agent.approved", { userId, chatId, proposed, added: outcome.added });
  } else {
    log("agent.cancelled", { userId, chatId, proposed });
  }

  const stream = createUIMessageStream<ChatUIMessage>({
    originalMessages: stored,
    execute({ writer }) {
      writer.write({ type: "start", messageId: target.id });
      writer.write({
        type: "tool-approval-response",
        approvalId: approval.approvalId,
        approved: outcome.approved,
      });
      if (outcome.approved) {
        writer.write({
          type: "tool-output-available",
          toolCallId: outcome.toolCallId,
          output: { added: outcome.added },
        });
      } else {
        writer.write({ type: "tool-output-denied", toolCallId: outcome.toolCallId });
      }
      writeText(writer, outcome.approved ? addedTasksText(outcome.added) : NO_TASKS_ADDED);
      writer.write({ type: "finish", messageMetadata: { status: "complete" } });
    },
    onError: (error) => {
      console.error("Approval stream failed", error);
      reportError(error, "approval");
      return "Something went wrong. Reload the chat to see what was saved.";
    },
    // The decision is already stored (answerProposal); this adds the line under it.
    async onEnd({ responseMessage }) {
      try {
        await saveAnswer(userId, chatId, responseMessage, "complete");
      } catch (error) {
        console.error(`Couldn't save the reply to approval ${approval.approvalId}`, error);
        reportError(error, "approval-save");
      }
    },
  });

  return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
}

// A canned answer, as one text part.
function writeText(writer: UIMessageStreamWriter<ChatUIMessage>, text: string) {
  const id = randomUUID();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

// After the agent ends: the checked proposal for the approval card. A proposal none of whose
// tasks could be tied to a passage is turned down at once, with a line saying so.
function writeProposal(
  writer: UIMessageStreamWriter<ChatUIMessage>,
  agent: AgentStream,
  proposal: Proposal | null,
) {
  if (!proposal) {
    if (!agent.filter.text.trim()) {
      writeText(
        writer,
        "I couldn't finish picking out tasks from your documents. Try asking about one document at a time.",
      );
    }
    return;
  }
  if (proposal.tasks.length > 0) {
    writer.write({ type: "data-proposal", id: "proposal", data: proposal });
    return;
  }
  console.warn("Turned down a proposal with no task tied to a passage", proposal);
  const approvalId = agent.run.proposal?.approvalId;
  if (approvalId) writer.write({ type: "tool-approval-response", approvalId, approved: false });
  writer.write({ type: "tool-output-denied", toolCallId: proposal.toolCallId });
  writeText(
    writer,
    "None of the tasks I found could be tied to a passage, so none were suggested.",
  );
}

// Tool parts are stored only in a settled state; one that failed (bad input, a failed search)
// is dropped, so a saved chat always loads.
function keepToolPart(part: ChatMessagePart): boolean {
  if (part.type !== "tool-searchDocuments" && part.type !== "tool-proposeTasks") return true;
  return (
    part.state === "output-available" ||
    part.state === "approval-requested" ||
    part.state === "output-denied"
  );
}

type Final = { citations: Citation[]; proposal: Proposal | null };

// Resolves once; the filter's state no longer changes after the stream ends.
const resolved = new WeakMap<object, Final>();

function finalOf(answer: AnswerStream | null, agent: AgentStream | null): Final {
  const stream = agent ?? answer;
  if (!stream) return { citations: [], proposal: null };
  let final = resolved.get(stream);
  if (!final) {
    const result = agent ? agent.finish() : { ...answer!.finish(), proposal: null };
    if (stream.filter.dropped.length > 0 || result.dropped.length > 0) {
      console.warn("Dropped citations to sources that weren't retrieved", {
        markers: stream.filter.dropped,
        quotes: result.dropped.map((q) => q.source),
      });
    }
    final = { citations: result.citations, proposal: result.proposal };
    resolved.set(stream, final);
  }
  return final;
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

// How many tasks the answer's proposal held, for the logs.
function proposedCount(message: ChatUIMessage): number {
  for (const part of message.parts) {
    if (part.type === "data-proposal") return part.data.tasks.length;
  }
  return 0;
}
