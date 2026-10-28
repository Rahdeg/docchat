import "server-only";

import { generateText, streamText, type TextStreamPart, type ToolSet } from "ai";

import type { ChatUIMessage, PassageData } from "@/features/chat/message";
import { PASSAGE_LIMIT } from "@/features/chat/find-rules";

import { createModelCaller } from "./call-model";
import { CitationFilter, parseCitationBlock, resolveCitations, type Resolved } from "./citations";
import { chatConfig, MIN_SIMILARITY } from "./models";
import {
  ANSWER_SYSTEM_PROMPT,
  answerMessages,
  noPassagesAnswer,
  REWRITE_SYSTEM_PROMPT,
  rewritePrompt,
} from "./prompts";
import { searchPassages } from "./retrieve";
import { recordGeneration } from "./usage";

// Answering a question from the user's documents (docs/adr/0006): rewrite a follow-up into a
// standalone query, search, then stream an answer whose citations are checked against the
// passages. Shared by POST /api/chat and the answer eval.

// Passages an answer reads.
export const ANSWER_PASSAGES = PASSAGE_LIMIT;
const ANSWER_MAX_OUTPUT_TOKENS = 1_500;
const REWRITE_MAX_OUTPUT_TOKENS = 120;
// A provider that stops responding fails the request instead of holding it open. The first
// chunk includes thinking time; the total stays under the chat route's maxDuration.
const ANSWER_TIMEOUT = { firstChunkMs: 30_000, totalMs: 100_000 };
export const SHORT_CALL_TIMEOUT_MS = 30_000;

// Rewrites and judgements run on the chat provider's schedule, retrying rate limits.
export const callChatModel = createModelCaller("Chat", () => chatConfig.limits);

// The latest question as a standalone search query, using the conversation to resolve what it
// refers to. The first question in a chat is searched as asked (no model call). A failed
// rewrite falls back to the question: it shouldn't cost the user their answer.
export async function rewriteQuery(
  userId: string,
  history: readonly ChatUIMessage[],
  question: string,
): Promise<string> {
  if (!history.some((message) => message.role === "user")) return question;
  const { id, model, providerOptions } = chatConfig.models.rewrite;
  const prompt = rewritePrompt(history, question);
  try {
    const result = await callChatModel(() =>
      generateText({
        model,
        instructions: REWRITE_SYSTEM_PROMPT,
        prompt,
        providerOptions,
        maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        timeout: SHORT_CALL_TIMEOUT_MS,
      }),
    );
    await recordGeneration({
      userId,
      kind: "rewrite",
      model: id,
      usage: result.totalUsage,
      prompt: REWRITE_SYSTEM_PROMPT + prompt,
      output: result.text,
    });
    const query = result.text
      .trim()
      .split("\n")[0]!
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();
    return query.length >= 3 && query.length <= 500 ? query : question;
  } catch (error) {
    console.warn("Couldn't rewrite the follow-up; searching the question as asked", error);
    return question;
  }
}

type FindOptions = { userId: string; query: string; documentIds?: readonly string[] };

// The passages an answer is written from, best first. Weak matches are dropped: when none is
// left, there's nothing to answer from and no model call.
export async function findAnswerPassages({
  userId,
  query,
  documentIds,
}: FindOptions): Promise<PassageData[]> {
  return searchPassages({
    userId,
    query,
    documentIds,
    limit: ANSWER_PASSAGES,
    minSimilarity: MIN_SIMILARITY,
  });
}

export { noPassagesAnswer };

type StreamOptions = {
  userId: string;
  question: string;
  history: readonly ChatUIMessage[];
  // Numbered [1]..[N] in the prompt, in this order.
  passages: readonly PassageData[];
  abortSignal?: AbortSignal;
  // A source cited for the first time (see CitationFilter).
  onCite?: (order: readonly number[]) => void;
};

export type AnswerStream = {
  result: ReturnType<typeof streamText>;
  filter: CitationFilter;
  // After the stream ends: the citations, with their quotes found in the passages.
  finish: () => Resolved;
};

// Streams an answer. Its text stream (result.stream) is already cleaned: markers renumbered,
// citations block removed. Usage is recorded once, when it ends, stops or fails.
export function streamAnswer({
  userId,
  question,
  history,
  passages,
  abortSignal,
  onCite,
}: StreamOptions): AnswerStream {
  const filter = new CitationFilter({ sourceCount: passages.length, onCite });
  const messages = answerMessages(history, question, passages);
  const { id, model, providerOptions } = chatConfig.models.answer;

  let recorded = false;
  function record(usage?: Parameters<typeof recordGeneration>[0]["usage"]) {
    if (recorded) return;
    recorded = true;
    void recordGeneration({
      userId,
      kind: "chat",
      model: id,
      usage,
      prompt: ANSWER_SYSTEM_PROMPT + messages.map((m) => JSON.stringify(m.content)).join("\n"),
      output: filter.text + filter.block,
    });
  }

  const result = streamText({
    model,
    instructions: ANSWER_SYSTEM_PROMPT,
    messages,
    providerOptions,
    maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
    abortSignal,
    timeout: ANSWER_TIMEOUT,
    experimental_transform: citationTransform(filter),
    onEnd: ({ totalUsage }) => record(totalUsage),
    onAbort: () => record(),
    // A request that failed before writing anything costs nothing and isn't counted.
    onError: ({ error }) => {
      console.error("Answer generation failed", error);
      if (filter.text || filter.block) record();
    },
  });

  return {
    result,
    filter,
    finish: () =>
      resolveCitations({ order: filter.order, quotes: parseCitationBlock(filter.block), passages }),
  };
}

// Runs the model's text through the citation filter on its way out of streamText.
function citationTransform(filter: CitationFilter) {
  return () =>
    new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      transform(part, controller) {
        if (part.type === "text-delta") {
          const text = filter.push(part.text);
          if (text) controller.enqueue({ ...part, text });
          return;
        }
        if (part.type === "text-end") {
          const rest = filter.flush();
          if (rest) controller.enqueue({ type: "text-delta", id: part.id, text: rest });
        }
        controller.enqueue(part);
      },
    });
}

export type Answer = {
  query: string;
  passages: PassageData[];
  text: string;
  noAnswer: boolean;
  // False when no passage matched, so no model was called.
  generated: boolean;
} & Resolved;

type AnswerOptions = FindOptions & {
  history?: readonly ChatUIMessage[];
  // Names for the "no passages" answer.
  documentNames: readonly string[];
};

// The whole pipeline to completion, without streaming to anyone: for the eval and tests.
export async function answerQuestion({
  userId,
  query: question,
  documentIds,
  history = [],
  documentNames,
}: AnswerOptions): Promise<Answer> {
  const query = await rewriteQuery(userId, history, question);
  const passages = await findAnswerPassages({ userId, query, documentIds });
  if (passages.length === 0) {
    const text = noPassagesAnswer(documentNames, !!documentIds);
    return { query, passages, text, noAnswer: true, generated: false, citations: [], dropped: [] };
  }

  const answer = streamAnswer({ userId, question, history, passages });
  let failure: unknown = null;
  await answer.result.consumeStream({ onError: (error) => (failure = error) });
  if (failure) throw failure;
  return {
    query,
    passages,
    text: answer.filter.text,
    noAnswer: answer.filter.noAnswer,
    generated: true,
    ...answer.finish(),
  };
}
