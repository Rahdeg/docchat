import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/db", () => ({ db: { execute: mocks.execute } }));

const { GET } = await import("./route");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/health", () => {
  it("answers 200 when the database answers", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 with no details when the database doesn't", async () => {
    mocks.execute.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 (secret host)"));
    const response = await GET();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "error" });
    expect(text).not.toMatch(/ECONN|5432|host/);
  });
});
