import { afterEach, describe, expect, it, vi } from "vitest";

import { assertTestDoublesAllowed, testDoublesAllowed, testDoublesIn } from "./test-doubles";

const fakes = { EMBEDDING_PROVIDER: "fake", CHAT_PROVIDER: "fake", STORAGE_DRIVER: "local" };

describe("testDoublesAllowed", () => {
  it("allows them under Vitest and in CI", () => {
    expect(testDoublesAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(testDoublesAllowed({ NODE_ENV: "production", CI: "true" })).toBe(true);
    expect(testDoublesAllowed({ NODE_ENV: "production", CI: "1" })).toBe(true);
  });

  it("refuses them in a production server, in development, and on Vercel even with CI set", () => {
    expect(testDoublesAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(testDoublesAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(testDoublesAllowed({ NODE_ENV: "production", CI: "false" })).toBe(false);
    expect(testDoublesAllowed({ NODE_ENV: "production", CI: "1", VERCEL: "1" })).toBe(false);
    expect(testDoublesAllowed({ NODE_ENV: "test", VERCEL: "1" })).toBe(false);
  });
});

describe("assertTestDoublesAllowed (server start)", () => {
  it("names every test double in use", () => {
    expect(testDoublesIn(fakes)).toEqual([
      "EMBEDDING_PROVIDER=fake",
      "CHAT_PROVIDER=fake",
      "STORAGE_DRIVER=local",
    ]);
    expect(testDoublesIn({ EMBEDDING_PROVIDER: "gateway", STORAGE_DRIVER: "blob" })).toEqual([]);
  });

  it("refuses to start a production server with fake providers or local storage", () => {
    for (const [key, value] of Object.entries(fakes)) {
      expect(() => assertTestDoublesAllowed({ [key]: value }, { NODE_ENV: "production" })).toThrow(
        `Refusing to start with ${key}=${value}`,
      );
    }
    expect(() =>
      assertTestDoublesAllowed(fakes, { NODE_ENV: "production", CI: "1", VERCEL: "1" }),
    ).toThrow(/Refusing to start/);
  });

  it("starts with real services anywhere, and with test doubles in CI", () => {
    expect(() =>
      assertTestDoublesAllowed(
        { EMBEDDING_PROVIDER: "gateway", CHAT_PROVIDER: "gateway", STORAGE_DRIVER: "blob" },
        { NODE_ENV: "production" },
      ),
    ).not.toThrow();
    expect(() =>
      assertTestDoublesAllowed(fakes, { NODE_ENV: "production", CI: "1" }),
    ).not.toThrow();
  });
});

describe("env validation", () => {
  const required = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    CLERK_SECRET_KEY: "sk_test_x",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_x",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
    SKIP_ENV_VALIDATION: "",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadEnv(vars: Record<string, string>) {
    for (const [key, value] of Object.entries({ ...required, ...vars })) vi.stubEnv(key, value);
    vi.spyOn(console, "error").mockImplementation(() => {});
    return (await import("./env")).env;
  }

  it.each(Object.entries(fakes))("rejects %s=%s in production", async (key, value) => {
    await expect(
      loadEnv({ NODE_ENV: "production", CI: "", VERCEL: "", [key]: value }),
    ).rejects.toThrow(/Invalid environment variables/);
  });

  it("accepts them in CI", async () => {
    const env = await loadEnv({ NODE_ENV: "production", CI: "true", VERCEL: "", ...fakes });
    expect(env.EMBEDDING_PROVIDER).toBe("fake");
    expect(env.STORAGE_DRIVER).toBe("local");
  });
});
