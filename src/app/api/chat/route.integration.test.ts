import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hasChatKey, hasEmbeddingKey } from "@/server/ai/models";

// POST /api/chat against the real database: only Clerk is faked. The ownership block needs
// DATABASE_URL; the reload block also embeds and answers for real, so it needs both providers'
// keys and LIVE_CHAT_TESTS=1 (the Gemini free tier allows 20 answers a day). CI has neither.
// Modules load lazily so CI never connects.
const hasDatabase = !!process.env.DATABASE_URL;
const canAnswer = hasDatabase && hasEmbeddingKey && hasChatKey && !!process.env.LIVE_CHAT_TESTS;

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.userId }) }));

type Modules = {
  POST: typeof import("./route").POST;
  queries: typeof import("@/features/chat/queries");
  mutations: typeof import("@/features/chat/mutations");
  db: typeof import("@/server/db").db;
  schema: typeof import("@/server/db/schema");
  orm: typeof import("drizzle-orm");
};

async function loadModules(): Promise<Modules> {
  return {
    POST: (await import("./route")).POST,
    queries: await import("@/features/chat/queries"),
    mutations: await import("@/features/chat/mutations"),
    db: (await import("@/server/db")).db,
    schema: await import("@/server/db/schema"),
    orm: await import("drizzle-orm"),
  };
}

const alice = `test_alice_${randomUUID()}`;
const bob = `test_bob_${randomUUID()}`;
let m: Modules;

function ask(chatId: string, text: string, trigger = "submit-message") {
  return m.POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        trigger,
        message: { id: randomUUID(), role: "user", parts: [{ type: "text", text }] },
      }),
    }),
  );
}

async function chunks(response: Response): Promise<Record<string, unknown>[]> {
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

beforeAll(async () => {
  if (hasDatabase) m = await loadModules();
});

afterAll(async () => {
  if (!hasDatabase) return;
  const users = [alice, bob];
  await m.db.delete(m.schema.chat).where(m.orm.inArray(m.schema.chat.userId, users));
  await m.db.delete(m.schema.document).where(m.orm.inArray(m.schema.document.userId, users));
  await m.db.delete(m.schema.aiUsage).where(m.orm.inArray(m.schema.aiUsage.userId, users));
  await m.db.$client.end();
});

describe.skipIf(!hasDatabase)("chat ownership (integration)", () => {
  const chatId = randomUUID();

  beforeAll(async () => {
    await m.mutations.ensureChat(alice, chatId, "Alice's chat");
    await m.mutations.saveUserMessage(alice, chatId, {
      id: randomUUID(),
      parts: [{ type: "text", text: "What is my rent?" }],
    });
  });

  it("doesn't let user B read user A's chat", async () => {
    expect(await m.queries.getChat(bob, chatId)).toBeNull();
    expect(await m.queries.listMessages(bob, chatId)).toEqual([]);
    expect(await m.queries.listMessages(alice, chatId)).toHaveLength(1);
  });

  it("doesn't let user B post to user A's chat", async () => {
    session.userId = bob;

    const response = await ask(chatId, "What is Alice's rent?");

    expect(response.status).toBe(404);
    expect(await m.queries.listMessages(alice, chatId)).toHaveLength(1);
    expect(await m.queries.getChat(alice, chatId)).toMatchObject({ title: "Alice's chat" });
  });

  it("doesn't let user B rename, delete or rate user A's chat", async () => {
    expect(await m.mutations.renameChat(bob, chatId, "Mine")).toBe(false);
    expect(await m.mutations.deleteChat(bob, chatId)).toBe(false);
    const [question] = await m.queries.listMessages(alice, chatId);
    expect(await m.mutations.setFeedback(bob, question!.id, "down")).toBe(false);
    expect(await m.queries.getChat(alice, chatId)).not.toBeNull();
  });
});

describe.skipIf(!canAnswer)("chat reload (integration)", { timeout: 240_000 }, () => {
  const chatId = randomUUID();

  beforeAll(async () => {
    const { indexDocument } = await import("@/server/ingest/index-document");
    const bytes = new Uint8Array(readFileSync("tests/evals/fixtures/tenancy-agreement.pdf"));
    const [doc] = await m.db
      .insert(m.schema.document)
      .values({
        userId: alice,
        name: "Tenancy agreement.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        blobPathname: `users/${alice}/tenancy.pdf`,
      })
      .returning({ id: m.schema.document.id });
    await indexDocument(alice, doc!.id, { load: async () => bytes });
  }, 240_000);

  it("reloads a chat with the same text, passages and citations it streamed", async () => {
    session.userId = alice;

    const response = await ask(
      chatId,
      "How much notice does my landlord need to give before raising the rent?",
    );
    expect(response.status).toBe(200);
    const streamed = await chunks(response);

    const text = streamed.flatMap((c) => (c.type === "text-delta" ? [c.delta] : [])).join("");
    const passages = streamed.find((c) => c.type === "data-passages")!.data;
    const citations = streamed.filter((c) => c.type === "data-citations").at(-1)!.data;
    expect(citations).toMatchObject({ final: true });

    const messages = await m.queries.listMessages(alice, chatId);
    expect(messages.map((msg) => msg.role)).toEqual(["user", "assistant"]);
    const answer = messages[1]!;
    expect(answer.metadata).toMatchObject({ status: "complete", feedback: null });
    const part = (type: string) =>
      answer.parts.find((p) => p.type === type) as { data?: unknown; text?: string };
    expect(part("text").text).toBe(text);
    expect(part("data-passages").data).toEqual(passages);
    expect(part("data-citations").data).toEqual(citations);
    expect(await m.queries.getChat(alice, chatId)).toMatchObject({
      title: "How much notice does my landlord need to give before raising…",
    });
  });
});
