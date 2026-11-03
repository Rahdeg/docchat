import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ProposeTasksInput } from "@/features/chat/agent-parts";
import type { ChatMessagePart, PassageData } from "@/features/chat/message";

// answerProposal against the real database: the only way the agent's tasks are saved.
describe.skipIf(!process.env.DATABASE_URL)("answerProposal (integration)", () => {
  const alice = `test_alice_${randomUUID()}`;
  const bob = `test_bob_${randomUUID()}`;
  const approvalId = "approval_1";

  let m: {
    agent: typeof import("./agent-tasks");
    db: typeof import("@/server/db");
    schema: typeof import("@/server/db/schema");
    orm: typeof import("drizzle-orm");
    dims: number;
  };
  let chatId: string;
  let messageId: string;
  let alicePassage: PassageData;
  let bobPassage: PassageData;

  const content =
    "13.2 The Tenant has seven days from the start date to return the Inventory signed. The tenancy starts on 1 March 2026.";

  async function insertChunk(userId: string, name: string): Promise<PassageData> {
    const [doc] = await m.db.db
      .insert(m.schema.document)
      .values({ userId, name, mimeType: "application/pdf", sizeBytes: 1, status: "ready" })
      .returning();
    const [row] = await m.db.db
      .insert(m.schema.chunk)
      .values({
        documentId: doc!.id,
        userId,
        content,
        page: 1,
        position: 0,
        tokenCount: 30,
        startOffset: 0,
        endOffset: content.length,
        embedding: Array.from({ length: m.dims }, () => 0.01),
        embeddingModel: "test/model",
      })
      .returning();
    return {
      chunkId: row!.id,
      documentId: doc!.id,
      name,
      mimeType: "application/pdf",
      hasFile: false,
      page: 1,
      content,
      startOffset: 0,
      endOffset: content.length,
      similarity: 0.8,
    };
  }

  const input: ProposeTasksInput = {
    tasks: [
      {
        title: "Return the signed inventory",
        dueDate: "2026-03-08",
        dueNote: "within seven days of the start date",
        source: {
          number: 1,
          quote: "The Tenant has seven days from the start date to return the Inventory signed.",
          label: "Clause 13.2",
        },
      },
      {
        title: "Invented date",
        dueDate: "2026-04-30",
        source: { number: 1, quote: "return the Inventory signed" },
      },
      // Bob's chunk, as if it had got into the run: never linked.
      { title: "From another user", source: { number: 2, quote: "return the Inventory signed" } },
      // Not one of the run's passages: dropped.
      { title: "Out of the run", source: { number: 7, quote: "anything" } },
    ],
  };

  function parts(): ChatMessagePart[] {
    return [
      {
        type: "data-passages",
        id: "passages",
        data: { query: "checklist", passages: [alicePassage, bobPassage] },
      },
      {
        type: "tool-proposeTasks",
        toolCallId: "call_1",
        state: "approval-requested",
        input,
        approval: { id: approvalId },
      },
    ];
  }

  beforeAll(async () => {
    m = {
      agent: await import("./agent-tasks"),
      db: await import("@/server/db"),
      schema: await import("@/server/db/schema"),
      orm: await import("drizzle-orm"),
      dims: (await import("@/server/ai/constants")).EMBEDDING_DIMENSIONS,
    };
    alicePassage = await insertChunk(alice, "Tenancy agreement.pdf");
    bobPassage = await insertChunk(bob, "Bob's lease.pdf");
  });

  beforeEach(async () => {
    const { inArray } = m.orm;
    await m.db.db.delete(m.schema.task).where(inArray(m.schema.task.userId, [alice, bob]));
    await m.db.db.delete(m.schema.chat).where(inArray(m.schema.chat.userId, [alice, bob]));
    const [chat] = await m.db.db
      .insert(m.schema.chat)
      .values({ userId: alice, title: "Move in" })
      .returning();
    chatId = chat!.id;
    await m.db.db.insert(m.schema.message).values({
      chatId,
      userId: alice,
      role: "user",
      parts: [{ type: "text", text: "Make a checklist from my tenancy agreement" }],
      createdAt: new Date(Date.now() - 60_000),
    });
    const [answer] = await m.db.db
      .insert(m.schema.message)
      .values({ chatId, userId: alice, role: "assistant", parts: parts() })
      .returning();
    messageId = answer!.id;
  });

  afterAll(async () => {
    const { inArray } = m.orm;
    await m.db.db.delete(m.schema.task).where(inArray(m.schema.task.userId, [alice, bob]));
    await m.db.db.delete(m.schema.chat).where(inArray(m.schema.chat.userId, [alice, bob]));
    await m.db.db.delete(m.schema.document).where(inArray(m.schema.document.userId, [alice, bob]));
    await m.db.db.$client.end();
  });

  const tasksOf = (userId: string) =>
    m.db.db.select().from(m.schema.task).where(m.orm.eq(m.schema.task.userId, userId));

  it("adds only the ticked tasks, with the user's edits and checked sources", async () => {
    const outcome = await m.agent.answerProposal(alice, chatId, {
      messageId,
      approvalId,
      approved: true,
      tasks: [
        { index: 0, title: "Sign and return the inventory", dueDate: "2026-03-08" },
        { index: 1, title: "Invented date", dueDate: null },
        { index: 2, title: "From another user", dueDate: null },
      ],
    });
    expect(outcome).toMatchObject({ ok: true, approved: true, added: 3 });

    const saved = await tasksOf(alice);
    const first = saved.find((t) => t.title === "Sign and return the inventory")!;
    expect(first).toMatchObject({
      createdBy: "agent",
      chatId,
      dueDate: "2026-03-08",
      dueNote: "within seven days of the start date",
      sourceDocumentId: alicePassage.documentId,
      sourceChunkId: alicePassage.chunkId,
      sourceLabel: "clause 13.2",
    });
    expect(content.slice(first.sourceStartOffset!, first.sourceEndOffset!)).toContain(
      "seven days from the start date",
    );

    // Bob's chunk is never linked, even though it was in the stored passages.
    const foreign = saved.find((t) => t.title === "From another user")!;
    expect(foreign).toMatchObject({ sourceChunkId: null, sourceDocumentId: null });
    expect(await tasksOf(bob)).toEqual([]);

    // The decision is recorded on the message.
    const [message] = await m.db.db
      .select()
      .from(m.schema.message)
      .where(m.orm.eq(m.schema.message.id, messageId));
    expect(message!.parts.find((p) => p.type === "tool-proposeTasks")).toMatchObject({
      state: "output-available",
      output: { added: 3 },
      approval: { id: approvalId, approved: true },
    });
  });

  it("only offers the proposal's checked tasks: a source outside the run isn't one", async () => {
    // Index 3 would be "Out of the run", which the check dropped; only 0..2 exist.
    const outcome = await m.agent.answerProposal(alice, chatId, {
      messageId,
      approvalId,
      approved: true,
      tasks: [{ index: 3, title: "Out of the run", dueDate: null }],
    });
    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(await tasksOf(alice)).toEqual([]);
  });

  it("adds nothing when approved twice, even at the same time", async () => {
    const request = {
      messageId,
      approvalId,
      approved: true,
      tasks: [{ index: 0, title: "Return the signed inventory", dueDate: null }],
    };
    const outcomes = await Promise.all([
      m.agent.answerProposal(alice, chatId, request),
      m.agent.answerProposal(alice, chatId, request),
    ]);

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)).toMatchObject({
      status: 409,
      error: "These tasks were already added.",
    });
    expect(await tasksOf(alice)).toHaveLength(1);
  });

  it("on Cancel saves nothing, and can't be approved afterwards", async () => {
    expect(
      await m.agent.answerProposal(alice, chatId, { messageId, approvalId, approved: false }),
    ).toMatchObject({ ok: true, approved: false, added: 0 });
    expect(
      await m.agent.answerProposal(alice, chatId, {
        messageId,
        approvalId,
        approved: true,
        tasks: [{ index: 0, title: "Return the signed inventory", dueDate: null }],
      }),
    ).toMatchObject({ ok: false, status: 409, error: "You already cancelled these tasks." });
    expect(await tasksOf(alice)).toEqual([]);
  });

  it("can't touch another user's chat or message", async () => {
    const tasks = [{ index: 0, title: "Mine now", dueDate: null }];
    expect(
      await m.agent.answerProposal(bob, chatId, { messageId, approvalId, approved: true, tasks }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await tasksOf(bob)).toEqual([]);
    expect(await tasksOf(alice)).toEqual([]);
  });

  it("refuses an unknown approval id and an empty approval", async () => {
    expect(
      await m.agent.answerProposal(alice, chatId, {
        messageId,
        approvalId: "someone_else",
        approved: true,
        tasks: [{ index: 0, title: "A", dueDate: null }],
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await m.agent.answerProposal(alice, chatId, {
        messageId,
        approvalId,
        approved: true,
        tasks: [],
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});
