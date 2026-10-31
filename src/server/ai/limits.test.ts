import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $count: vi.fn() }));
vi.mock("@/server/db", () => ({ db }));
vi.mock("@/lib/env", () => ({ env: { CHAT_DAILY_LIMIT: 3 } }));

const { checkDailyLimit, dailyLimitFrom, dailyLimitMessage, CHAT_DAILY_LIMIT } =
  await import("./limits");

beforeEach(() => db.$count.mockReset());

describe("checkDailyLimit", () => {
  it("reads CHAT_DAILY_LIMIT", () => {
    expect(CHAT_DAILY_LIMIT).toBe(3);
  });

  it("defaults to 10 a day on the Gemini free tier and 50 on the gateway", () => {
    expect(dailyLimitFrom({ CHAT_PROVIDER: "google" })).toBe(10);
    expect(dailyLimitFrom({})).toBe(10);
    expect(dailyLimitFrom({ CHAT_PROVIDER: "gateway" })).toBe(50);
    expect(dailyLimitFrom({ CHAT_PROVIDER: "google", CHAT_DAILY_LIMIT: 25 })).toBe(25);
  });

  it("allows answers until the limit, then refuses with the reset time", async () => {
    db.$count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);

    expect(await checkDailyLimit("user_a")).toEqual({ ok: true });
    expect(await checkDailyLimit("user_a")).toEqual({
      ok: false,
      message: "You've reached today's limit of 3 questions. It resets at midnight UTC.",
    });
  });

  it("counts one user's chat usage since midnight UTC", async () => {
    db.$count.mockResolvedValue(0);

    await checkDailyLimit("user_a");

    const [table, where] = db.$count.mock.calls[0]!;
    expect(table).toBeDefined();
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const query = new PgDialect().sqlToQuery(where);
    expect(query.sql).toContain(`date_trunc('day', now(), 'UTC')`);
    expect(query.params).toEqual(["user_a", "chat"]);
  });

  it("words the message with the limit", () => {
    expect(dailyLimitMessage(50)).toBe(
      "You've reached today's limit of 50 questions. It resets at midnight UTC.",
    );
  });
});
