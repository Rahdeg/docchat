import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  env: {} as Record<string, string | undefined>,
}));

vi.mock("@sentry/nextjs", () => ({ init: mocks.init, captureRequestError: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));

const { register } = await import("./instrumentation");

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
});

describe("register (server start)", () => {
  it("leaves Sentry off without SENTRY_DSN", async () => {
    await register();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("turns Sentry on with SENTRY_DSN, with the scrubbing options", async () => {
    mocks.env.SENTRY_DSN = "https://key@o1.ingest.sentry.io/1";
    mocks.env.VERCEL_ENV = "production";
    await register();
    expect(mocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o1.ingest.sentry.io/1",
        environment: "production",
        tracesSampleRate: 0,
        dataCollection: expect.objectContaining({ userInfo: false, genAI: expect.anything() }),
      }),
    );
  });

  it("refuses to start a production server with test doubles", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "");
    vi.stubEnv("VERCEL", "");
    mocks.env.CHAT_PROVIDER = "fake";
    await expect(register()).rejects.toThrow("Refusing to start with CHAT_PROVIDER=fake");
    vi.unstubAllEnvs();
  });
});
