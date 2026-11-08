import "server-only";

import { simulateReadableStream } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";

import type { ProposedTaskInput } from "@/features/chat/agent-parts";
import { UNRELATED_ANSWER } from "@/features/chat/message";

import { CITATIONS_CLOSE, CITATIONS_OPEN } from "./citations";
import { EMBEDDING_DIMENSIONS } from "./constants";
import { JUDGE_SYSTEM_PROMPT, REWRITE_SYSTEM_PROMPT } from "./prompts";

// The "fake" providers (EMBEDDING_PROVIDER=fake, CHAT_PROVIDER=fake): test doubles for the
// end-to-end tests in CI, so they run without AI quota (docs/adr/0009). Deterministic, offline,
// and refused outside tests and CI (src/lib/test-doubles.ts). Built on the AI SDK's own mock
// models (ai/test), so everything around them (pacing, usage rows, citations, tool approval)
// runs exactly as with a real provider.

// --- Embeddings: a hashed bag of words ---------------------------------------------------------

const STOP_WORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have he her his how " +
    "i if in into is it its me my no not of on or our she so than that the their them then there " +
    "these they this to too under up us was we were what when where which while who whom why will " +
    "with would you your yours about any all also am each just more most must only other over own " +
    "same should some such very"
  ).split(" "),
);

// Lowercased words without stop words, with plurals and -ing/-ed/-ly endings cut off, so "rents",
// "renting" and "rent" count as one term.
export function terms(text: string): string[] {
  const words =
    text
      .toLowerCase()
      .normalize("NFKD")
      .match(/[a-z0-9]+/g) ?? [];
  return words
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 4 ? word.replace(/(?:ing|ed|es|ly|s)$/, "") : word));
}

// 32-bit FNV-1a.
function hash(term: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < term.length; i += 1) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Each term adds to one dimension, with a sign from another bit of its hash so collisions tend
// to cancel out, weighted 1 + ln(count). Unit length, so cosine similarity is the dot product.
// Texts that share words score high; texts that share none score about 0.
export function fakeEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const counts = new Map<string, number>();
  for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);

  const vector = new Array<number>(dimensions).fill(0);
  for (const [term, count] of counts) {
    const h = hash(term);
    vector[h % dimensions]! += (h & 0x10000 ? -1 : 1) * (1 + Math.log(count));
  }
  const norm = Math.hypot(...vector);
  // An empty text still needs a valid, non-zero vector (pgvector can't take a cosine of zero).
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

export const fakeEmbeddingModel = new MockEmbeddingModelV4({
  provider: "fake",
  modelId: "hashed-bag-of-words",
  maxEmbeddingsPerCall: 100,
  supportsParallelCalls: true,
  doEmbed: async ({ values }) => ({
    embeddings: values.map((value) => fakeEmbedding(value)),
    usage: { tokens: values.reduce((sum, value) => sum + terms(value).length, 0) },
    warnings: [],
  }),
});

// --- Chat: extractive answers, with valid citations --------------------------------------------

type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];
type Prompt = CallOptions["prompt"];

type Source = { number: number; text: string };

// Every text the prompt carries: the system prompt, then each message's text parts and tool
// results, in order.
function promptTexts(prompt: Prompt): { system: string; texts: string[]; lastUser: string } {
  let system = "";
  let lastUser = "";
  const texts: string[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      system += message.content;
      continue;
    }
    for (const part of message.content) {
      let text = "";
      if (part.type === "text") text = part.text;
      else if (part.type === "tool-result") {
        const output: unknown = part.output;
        const value = typeof output === "object" && output && "value" in output ? output.value : "";
        text = typeof value === "string" ? value : "";
      }
      if (!text) continue;
      texts.push(text);
      if (message.role === "user") lastUser = text;
    }
  }
  return { system, texts, lastUser };
}

const SOURCE_BLOCK = /<source id="(\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g;

export function parseSources(texts: readonly string[]): Source[] {
  const sources = new Map<number, string>();
  for (const text of texts) {
    for (const match of text.matchAll(SOURCE_BLOCK)) {
      sources.set(Number(match[1]), match[2]!);
    }
  }
  return [...sources].map(([number, text]) => ({ number, text }));
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);
}

// The sentence sharing the most terms with the question, and its source; null when none shares
// any.
export function bestSentence(
  question: string,
  sources: readonly Source[],
): { source: number; sentence: string } | null {
  const wanted = new Set(terms(question));
  let best: { source: number; sentence: string; score: number } | null = null;
  for (const source of sources) {
    for (const sentence of sentences(source.text)) {
      const score = new Set(terms(sentence).filter((term) => wanted.has(term))).size;
      if (score > 0 && (!best || score > best.score)) {
        best = { source: source.number, sentence, score };
      }
    }
  }
  return best && { source: best.source, sentence: best.sentence };
}

// An answer in the shape ANSWER_SYSTEM_PROMPT asks for: the claim with its [n] marker, then the
// citations block quoting the sentence word for word.
export function fakeAnswer(question: string, sources: readonly Source[]): string {
  const best = bestSentence(question, sources);
  if (!best) return UNRELATED_ANSWER;
  const claim = best.sentence.replace(/[.!?]+$/, "");
  return [
    `${claim} [${best.source}].`,
    "",
    CITATIONS_OPEN,
    JSON.stringify({ source: best.source, quote: best.sentence }),
    CITATIONS_CLOSE,
  ].join("\n");
}

const DUTY = /\b(must|shall|should|is required to|are required to|needs? to|has to|have to)\s+/i;
const MAX_FAKE_TASKS = 8;

// Tasks from the sentences that say what someone must or should do: "The Tenant must return
// the keys." becomes "Return the keys". "should" makes it optional. No dates: the fake never
// sets one (the checks would drop a guessed date anyway).
export function fakeTasks(sources: readonly Source[]): ProposedTaskInput[] {
  const tasks: ProposedTaskInput[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const sentence of sentences(source.text)) {
      const duty = DUTY.exec(sentence);
      if (!duty) continue;
      const rest = sentence.slice(duty.index + duty[0].length).replace(/[.!?]+$/, "");
      const words = rest.split(" ");
      const short = words.slice(0, 16).join(" ");
      const title = short.charAt(0).toUpperCase() + short.slice(1);
      if (title.length < 3 || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      const label = /^(\d+(?:\.\d+)+)\s/.exec(sentence)?.[1];
      const dueNote = /\bwithin \d+ \w+(?: (?:of|after|before) [^,.;]+)?/i.exec(sentence)?.[0];
      tasks.push({
        title,
        ...(dueNote ? { dueNote } : {}),
        ...(/should/i.test(duty[1]!) ? { optional: true } : {}),
        source: {
          number: source.number,
          quote: sentence,
          ...(label ? { label: `clause ${label}` } : {}),
        },
      });
      if (tasks.length >= MAX_FAKE_TASKS) return tasks;
    }
  }
  return tasks;
}

// A judge verdict: supported when most of the claim's terms are in the passage.
function fakeVerdict(promptText: string): string {
  const passage = /<passage>\n([\s\S]*?)\n<\/passage>/.exec(promptText)?.[1] ?? "";
  const claim = /Claim: (.*)/.exec(promptText)?.[1] ?? "";
  const have = new Set(terms(passage));
  const claimTerms = terms(claim);
  const found = claimTerms.filter((term) => have.has(term)).length;
  const supported = claimTerms.length > 0 && found / claimTerms.length >= 0.5;
  return JSON.stringify({ supported, reason: `${found} of ${claimTerms.length} terms found` });
}

type Reply = { text: string; toolCall?: { toolName: string; input: string } };

// What the fake model replies to one call, by which job the system prompt sets.
export function fakeReply(options: Pick<CallOptions, "prompt" | "tools">): Reply {
  const { system, texts, lastUser } = promptTexts(options.prompt);

  if (system.startsWith(REWRITE_SYSTEM_PROMPT.slice(0, 60))) {
    return { text: /Follow-up: (.*)/.exec(lastUser)?.[1]?.trim() ?? lastUser };
  }
  if (system.startsWith(JUDGE_SYSTEM_PROMPT.slice(0, 60))) {
    return { text: fakeVerdict(lastUser) };
  }

  const sources = parseSources(texts);
  const question = /Question: ([\s\S]*)$/.exec(lastUser)?.[1]?.trim() ?? lastUser;
  const canPropose = options.tools?.some((tool) => tool.name === "proposeTasks") ?? false;
  const proposed = options.prompt.some(
    (message) =>
      message.role === "assistant" &&
      message.content.some((part) => part.type === "tool-call" && part.toolName === "proposeTasks"),
  );
  if (canPropose && !proposed) {
    const tasks = fakeTasks(sources);
    if (tasks.length === 0) return { text: UNRELATED_ANSWER };
    return {
      text: "Here are the tasks I found in your documents.",
      toolCall: { toolName: "proposeTasks", input: JSON.stringify({ tasks }) },
    };
  }
  return { text: fakeAnswer(question, sources) };
}

function usageOf(options: Pick<CallOptions, "prompt">, reply: Reply) {
  const input = promptTexts(options.prompt).texts.join(" ").split(/\s+/).length;
  const output = `${reply.text} ${reply.toolCall?.input ?? ""}`.split(/\s+/).length;
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

let calls = 0;

export const fakeChatModel = new MockLanguageModelV4({
  provider: "fake",
  modelId: "extractive",
  doGenerate: async (options) => {
    const reply = fakeReply(options);
    return {
      content: [{ type: "text", text: reply.text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: usageOf(options, reply),
      warnings: [],
    };
  },
  doStream: async (options) => {
    const reply = fakeReply(options);
    calls += 1;
    const id = `fake-${calls}`;
    // A few words per chunk, so the browser sees the answer stream in like a real one.
    const pieces = reply.text.match(/\S+\s*|\s+/g) ?? [];
    const deltas = [];
    for (let i = 0; i < pieces.length; i += 4) deltas.push(pieces.slice(i, i + 4).join(""));
    return {
      stream: simulateReadableStream({
        chunkDelayInMs: 5,
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id },
          ...deltas.map((delta) => ({ type: "text-delta" as const, id, delta })),
          { type: "text-end" as const, id },
          ...(reply.toolCall
            ? [
                {
                  type: "tool-call" as const,
                  toolCallId: `${id}-call`,
                  toolName: reply.toolCall.toolName,
                  input: reply.toolCall.input,
                },
              ]
            : []),
          {
            type: "finish" as const,
            finishReason: {
              unified: reply.toolCall ? ("tool-calls" as const) : ("stop" as const),
              raw: undefined,
            },
            usage: usageOf(options, reply),
          },
        ],
      }),
    };
  },
});
