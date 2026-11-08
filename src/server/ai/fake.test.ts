import { generateText, streamText, tool } from "ai";
import { beforeAll, describe, expect, it } from "vitest";

import { proposeTasksInput, proposeTasksOutput } from "@/features/chat/agent-parts";
import type { PassageData } from "@/features/chat/message";
import { UNRELATED_ANSWER } from "@/features/chat/message";
import { chunkPages } from "@/server/ai/chunk";
import { extractPages } from "@/server/ingest/extract";

import {
  fixtureBytes,
  isHit,
  loadEvalCases,
  type AnswerableQuestion,
} from "../../../tests/evals/retrieval-cases";

import { CitationFilter, parseCitationBlock, resolveCitations } from "./citations";
import { fakeChatModel, fakeEmbedding, fakeTasks, terms } from "./fake";
import { EMBEDDING_CONFIGS } from "./models";
import {
  AGENT_SYSTEM_PROMPT,
  agentMessages,
  ANSWER_SYSTEM_PROMPT,
  answerMessages,
  JUDGE_SYSTEM_PROMPT,
  judgePrompt,
  REWRITE_SYSTEM_PROMPT,
} from "./prompts";

const floor = EMBEDDING_CONFIGS.fake.minSimilarity;
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

function passage(content: string, n = 1): PassageData {
  return {
    chunkId: `00000000-0000-4000-8000-00000000000${n}`,
    documentId: "00000000-0000-4000-8000-0000000000aa",
    name: "Tenancy agreement.pdf",
    mimeType: "application/pdf",
    hasFile: true,
    page: 2,
    content,
    startOffset: 0,
    endOffset: content.length,
    similarity: 0.2,
  };
}

const RENT =
  "4.1 The rent is 1,150 pounds per calendar month. The Tenant must pay the rent on the first day of each month by standing order.";
const KEYS =
  "9.2 The Tenant must return all keys to the Landlord at the end of the tenancy. The Tenant should take meter readings on the day they move out.";

describe("fake embeddings", () => {
  it("are deterministic unit vectors of 1536 dimensions", () => {
    const a = fakeEmbedding("The rent is due monthly.");
    expect(a).toHaveLength(1536);
    expect(dot(a, a)).toBeCloseTo(1, 6);
    expect(fakeEmbedding("The rent is due monthly.")).toEqual(a);
  });

  it("give an empty text a valid vector", () => {
    const v = fakeEmbedding("the of and");
    expect(dot(v, v)).toBeCloseTo(1, 6);
  });

  it("treat plurals and -ing forms as one term", () => {
    expect(terms("Rents renting rented")).toEqual(["rent", "rent", "rent"]);
  });

  describe("against the retrieval eval's fixtures", () => {
    const cases = loadEvalCases();
    const chunks: { name: string; page: number; content: string; vector: number[] }[] = [];

    beforeAll(async () => {
      for (const fixture of cases.fixtures) {
        const pages = await extractPages(fixtureBytes(fixture.file), "pdf");
        for (const c of chunkPages(pages)) {
          chunks.push({ ...c, name: fixture.name, vector: fakeEmbedding(c.content) });
        }
      }
    });

    function rank(question: string) {
      const q = fakeEmbedding(question);
      return chunks.map((c) => ({ c, score: dot(q, c.vector) })).sort((a, b) => b.score - a.score);
    }

    const direct = cases.questions.filter((q): q is AnswerableQuestion => q.kind === "direct");

    it.each(direct.map((q) => [q.id, q] as const))(
      "%s: the right passage is in the top 3, above the floor",
      (_id, question) => {
        const ranked = rank(question.question);
        const at = ranked.findIndex(({ c }) => isHit(question, c));
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThan(3);
        expect(ranked[at]!.score).toBeGreaterThan(floor);
      },
    );

    it("an off-topic question finds nothing above the floor", () => {
      expect(rank("What is the capital of Mongolia?")[0]!.score).toBeLessThan(floor);
    });
  });
});

describe("fake chat model", () => {
  it("answers from the best-matching sentence with a citation that resolves", async () => {
    const passages = [passage(KEYS, 1), passage(RENT, 2)];
    const filter = new CitationFilter({ sourceCount: passages.length });
    const result = streamText({
      model: fakeChatModel,
      instructions: ANSWER_SYSTEM_PROMPT,
      messages: answerMessages([], "What is the monthly rent?", passages),
    });
    let shown = "";
    for await (const delta of result.textStream) shown += filter.push(delta);
    shown += filter.flush();

    expect(shown).toBe("4.1 The rent is 1,150 pounds per calendar month [1].");
    const { citations } = resolveCitations({
      order: filter.order,
      quotes: parseCitationBlock(filter.block),
      passages,
    });
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ number: 1, source: 2, matched: true });
    expect(RENT.slice(citations[0]!.start, citations[0]!.end)).toContain("1,150 pounds");
    expect((await result.totalUsage).outputTokens).toBeGreaterThan(0);
  });

  it("says the documents don't say when nothing matches", async () => {
    const { text } = await generateText({
      model: fakeChatModel,
      instructions: ANSWER_SYSTEM_PROMPT,
      messages: answerMessages([], "Is there a swimming pool?", [passage(RENT)]),
    });
    expect(text).toBe(UNRELATED_ANSWER);
    expect(text).toBe("Your documents don't say anything about that.");
  });

  it("proposes tasks from must/should sentences, through the SDK's approval", async () => {
    const passages = [passage(RENT, 1), passage(KEYS, 2)];
    const result = streamText({
      model: fakeChatModel,
      instructions: AGENT_SYSTEM_PROMPT,
      messages: agentMessages([], "Make me a move-out checklist", passages, [
        { id: passages[0]!.documentId, name: "Tenancy agreement.pdf" },
      ]),
      tools: {
        proposeTasks: tool({ inputSchema: proposeTasksInput, outputSchema: proposeTasksOutput }),
      },
      toolApproval: { proposeTasks: "user-approval" },
    });
    const parts = [];
    for await (const part of result.fullStream) parts.push(part);

    const call = parts.find((p) => p.type === "tool-call");
    expect(call).toBeDefined();
    const input = proposeTasksInput.parse(call!.type === "tool-call" ? call!.input : null);
    expect(input.tasks.map((t) => t.title)).toEqual([
      "Pay the rent on the first day of each month by standing order",
      "Return all keys to the Landlord at the end of the tenancy",
      "Take meter readings on the day they move out",
    ]);
    expect(input.tasks[2]).toMatchObject({ optional: true, source: { number: 2 } });
    expect(input.tasks.every((t) => !t.dueDate)).toBe(true);
    expect(parts.some((p) => p.type === "tool-approval-request")).toBe(true);
  });

  it("proposes nothing from passages without duties", () => {
    expect(fakeTasks([{ number: 1, text: "The flat has two bedrooms." }])).toEqual([]);
  });

  it("rewrites a follow-up as itself, and judges by shared terms", async () => {
    const rewrite = await generateText({
      model: fakeChatModel,
      instructions: REWRITE_SYSTEM_PROMPT,
      prompt: "Conversation:\nUser: rent?\n\nFollow-up: and the deposit?",
    });
    expect(rewrite.text).toBe("and the deposit?");

    const judge = await generateText({
      model: fakeChatModel,
      instructions: JUDGE_SYSTEM_PROMPT,
      prompt: judgePrompt("The rent is 1,150 pounds a month.", RENT),
    });
    expect(JSON.parse(judge.text)).toMatchObject({ supported: true });
  });
});
