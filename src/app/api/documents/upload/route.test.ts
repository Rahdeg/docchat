import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  countDocuments: vi.fn(),
  handleUpload: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/features/documents/queries", () => ({ countDocuments: mocks.countDocuments }));
// Stand-in for the SDK: run the route's onBeforeGenerateToken and return what it allowed.
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("@/server/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));

const { POST } = await import("./route");

const uuid = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function tokenRequest(pathname: string) {
  return new Request("http://localhost/api/documents/upload", {
    method: "POST",
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: null, multipart: false },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user_alice" });
  mocks.countDocuments.mockResolvedValue(0);
  mocks.consumeRateLimit.mockResolvedValue({ ok: true });
  mocks.handleUpload.mockImplementation(
    async ({
      body,
      onBeforeGenerateToken,
    }: {
      body: { payload: { pathname: string } };
      onBeforeGenerateToken: (pathname: string) => Promise<unknown>;
    }) => ({ allowed: await onBeforeGenerateToken(body.payload.pathname) }),
  );
});

describe("POST /api/documents/upload", () => {
  it("returns 401 to signed-out visitors without issuing a token", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await POST(tokenRequest(`users/user_alice/${uuid}-a.pdf`));

    expect(response.status).toBe(401);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("refuses a path in another user's folder", async () => {
    const response = await POST(tokenRequest(`users/user_bob/${uuid}-a.pdf`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That upload doesn't belong to your library." });
    // A refused path doesn't use up an upload.
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("counts each token against the upload limit, and answers 429 once it's used up", async () => {
    const ok = await POST(tokenRequest(`users/user_alice/${uuid}-a.pdf`));
    expect(ok.status).toBe(200);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("user_alice", "upload");

    const failure = { code: "RATE_LIMITED", bucket: "upload", max: 20, retryAfterSeconds: 600 };
    mocks.consumeRateLimit.mockResolvedValue({ ok: false, failure });
    const limited = await POST(tokenRequest(`users/user_alice/${uuid}-b.pdf`));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "You've uploaded 20 files in the last hour. You can upload more in 10 minutes.",
      limit: failure,
    });
  });

  it("refuses a disallowed file type", async () => {
    const response = await POST(tokenRequest(`users/user_alice/${uuid}-photo.png`));

    expect(response.status).toBe(400);
  });

  it("refuses a token once the user has 3 documents, before any upload or rate count", async () => {
    mocks.countDocuments.mockResolvedValue(3);

    const response = await POST(tokenRequest(`users/user_alice/${uuid}-a.pdf`));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "You've reached the free limit of 3 documents. Delete one to upload another.",
      limit: { code: "DOCUMENT_LIMIT", max: 3 },
    });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("allows only the file's own type, up to 10 MB, without overwriting", async () => {
    const response = await POST(tokenRequest(`users/user_alice/${uuid}-notes.md`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      allowed: {
        allowedContentTypes: ["text/markdown"],
        maximumSizeInBytes: 10 * 1024 * 1024,
        addRandomSuffix: false,
        allowOverwrite: false,
      },
    });
  });

  it("rejects a body that isn't a token request", async () => {
    const response = await POST(
      new Request("http://localhost/api/documents/upload", {
        method: "POST",
        body: JSON.stringify({ type: "blob.upload-completed", payload: {} }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });
});
