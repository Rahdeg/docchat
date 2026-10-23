import { describe, expect, it } from "vitest";

import { assertDevelopment } from "./assert-development";
import { fakeEmbedding } from "./fake-embedding";
import { DEFAULT_SEED_USER_ID, resolveSeedUserId } from "./seed-user";

describe("assertDevelopment", () => {
  it("allows development", () => {
    expect(() => assertDevelopment("development")).not.toThrow();
  });

  it.each(["production", "test", undefined])("refuses %s", (nodeEnv) => {
    expect(() => assertDevelopment(nodeEnv)).toThrow(/Refusing to seed/);
  });
});

describe("fakeEmbedding", () => {
  it("returns a deterministic unit vector of the requested size", () => {
    const vector = fakeEmbedding(7, 1536);

    expect(vector).toHaveLength(1536);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 10);
    expect(fakeEmbedding(7, 1536)).toEqual(vector);
    expect(fakeEmbedding(8, 1536)).not.toEqual(vector);
  });
});

describe("resolveSeedUserId", () => {
  it("falls back to the placeholder user", () => {
    expect(resolveSeedUserId([], undefined)).toBe(DEFAULT_SEED_USER_ID);
    expect(resolveSeedUserId([], "")).toBe(DEFAULT_SEED_USER_ID);
  });

  it("reads SEED_USER_ID", () => {
    expect(resolveSeedUserId([], "user_2abcDEF")).toBe("user_2abcDEF");
  });

  it("prefers --user over SEED_USER_ID, with or without a forwarded --", () => {
    expect(resolveSeedUserId(["--user", "user_fromArg"], "user_fromEnv")).toBe("user_fromArg");
    expect(resolveSeedUserId(["--", "--user=user_fromArg"], undefined)).toBe("user_fromArg");
  });

  it.each(["alice", "user_", "org_2abc", "user_2abc; DROP TABLE"])("rejects %s", (id) => {
    expect(() => resolveSeedUserId(["--user", id], undefined)).toThrow(/Invalid seed user/);
  });

  it("rejects unknown flags", () => {
    expect(() => resolveSeedUserId(["--usr", "user_x"], undefined)).toThrow();
  });
});
